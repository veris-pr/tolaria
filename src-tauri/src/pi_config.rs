use crate::ai_agents::AiAgentPermissionMode;
use crate::pi_cli::AgentStreamRequest;
use serde_json::{Map, Value};
use std::ffi::OsStr;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;

pub(crate) fn build_command(
    binary: &Path,
    request: &AgentStreamRequest,
    agent_dir: &Path,
) -> Result<std::process::Command, String> {
    prepare_agent_dir(agent_dir)?;
    write_mcp_config(
        agent_dir,
        &request.vault_path,
        &request.vault_paths,
        request.permission_mode,
    )?;

    let target = crate::cli_agent_runtime::command_target_avoiding_windows_cmd_shim(binary)?;
    let mut command = crate::hidden_command(&target.program);
    crate::cli_agent_runtime::configure_agent_command_environment(&mut command, binary);
    command.args(&target.prefix_args);
    command
        .args(build_args())
        .arg(build_prompt(request))
        .env("PI_CODING_AGENT_DIR", agent_dir)
        .current_dir(&request.vault_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

fn prepare_agent_dir(agent_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(agent_dir)
        .map_err(|error| format!("Failed to create Pi agent directory: {error}"))?;
    let Some(source_dir) = source_agent_dir() else {
        return Ok(());
    };

    seed_agent_dir(&source_dir, agent_dir)
}

fn source_agent_dir() -> Option<PathBuf> {
    std::env::var_os("PI_CODING_AGENT_DIR")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(default_agent_dir)
}

fn default_agent_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".pi").join("agent"))
}

fn seed_agent_dir(source_dir: &Path, agent_dir: &Path) -> Result<(), String> {
    if !source_dir.is_dir() || same_directory(source_dir, agent_dir) {
        return Ok(());
    }

    let entries = match std::fs::read_dir(source_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to read Pi agent directory at {}: {error}",
                source_dir.display()
            ));
        }
    };

    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read Pi agent file: {error}"))?;
        let target = agent_dir.join(entry.file_name());
        copy_agent_entry(&entry.path(), &target)?;
    }

    Ok(())
}

fn same_directory(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn copy_agent_entry(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = match std::fs::metadata(source) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect Pi agent config at {}: {error}",
                source.display()
            ));
        }
    };

    if metadata.is_dir() {
        seed_agent_dir(source, target)
    } else if metadata.is_file() {
        seed_agent_file(source, target, metadata)
    } else {
        Ok(())
    }
}

fn seed_agent_file(
    source: &Path,
    target: &Path,
    metadata: std::fs::Metadata,
) -> Result<(), String> {
    match rewritten_settings(source)? {
        Some(contents) => write_seeded_file(target, &contents, metadata),
        None => copy_agent_file(source, target, metadata),
    }
}

/// Pi resolves relative `packages` paths against the active agent dir, so a
/// seeded copy must pin them to the source dir they were installed under.
fn rewritten_settings(source: &Path) -> Result<Option<String>, String> {
    if source.file_name() != Some(OsStr::new("settings.json")) {
        return Ok(None);
    }
    let (Some(base), Ok(contents)) = (source.parent(), std::fs::read_to_string(source)) else {
        return Ok(None);
    };
    let Ok(mut settings) = serde_json::from_str::<Value>(&contents) else {
        return Ok(None);
    };
    if !rewrite_relative_packages(&mut settings, base) {
        return Ok(None);
    }
    serde_json::to_string_pretty(&settings)
        .map(Some)
        .map_err(|error| format!("Failed to serialize seeded Pi settings: {error}"))
}

fn rewrite_relative_packages(settings: &mut Value, base: &Path) -> bool {
    let Some(packages) = settings.get_mut("packages").and_then(Value::as_array_mut) else {
        return false;
    };
    let mut changed = false;
    for package in packages {
        if let Some(absolute) = absolute_package_path(package, base) {
            *package = Value::String(absolute);
            changed = true;
        }
    }
    changed
}

fn absolute_package_path(package: &Value, base: &Path) -> Option<String> {
    let path = package.as_str().filter(|path| is_relative_path(path))?;
    let absolute = lexically_normalized(&base.join(path));
    Some(absolute.to_string_lossy().into_owned())
}

fn is_relative_path(package: &str) -> bool {
    matches!(
        Path::new(package).components().next(),
        Some(Component::CurDir | Component::ParentDir)
    )
}

fn lexically_normalized(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir if normalized.pop() => {}
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn write_seeded_file(
    target: &Path,
    contents: &str,
    metadata: std::fs::Metadata,
) -> Result<(), String> {
    create_parent_dir(target)?;
    std::fs::write(target, contents).map_err(|error| {
        format!(
            "Failed to write seeded Pi agent config at {}: {error}",
            target.display()
        )
    })?;
    preserve_permissions(target, metadata)
}

fn copy_agent_file(
    source: &Path,
    target: &Path,
    metadata: std::fs::Metadata,
) -> Result<(), String> {
    create_parent_dir(target)?;
    match std::fs::copy(source, target) {
        Ok(_) => preserve_permissions(target, metadata),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to copy Pi agent config from {} to {}: {error}",
            source.display(),
            target.display()
        )),
    }
}

fn create_parent_dir(target: &Path) -> Result<(), String> {
    let Some(parent) = target.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create Pi agent config parent at {}: {error}",
            parent.display()
        )
    })
}

fn preserve_permissions(target: &Path, metadata: std::fs::Metadata) -> Result<(), String> {
    std::fs::set_permissions(target, metadata.permissions()).map_err(|error| {
        format!(
            "Failed to preserve Pi agent config permissions at {}: {error}",
            target.display()
        )
    })
}

fn build_args() -> Vec<String> {
    vec![
        "--mode".into(),
        "json".into(),
        "--no-session".into(),
        "--extension".into(),
        "npm:pi-mcp-adapter".into(),
    ]
}

fn build_prompt(request: &AgentStreamRequest) -> String {
    crate::cli_agent_runtime::build_prompt(&request.message, request.system_prompt.as_deref())
}

fn write_mcp_config(
    agent_dir: &Path,
    vault_path: &str,
    vault_paths: &[String],
    permission_mode: AiAgentPermissionMode,
) -> Result<(), String> {
    std::fs::create_dir_all(agent_dir)
        .map_err(|error| format!("Failed to create Pi agent directory: {error}"))?;
    let config_path = agent_dir.join("mcp.json");
    let config = build_mcp_config_from_base(
        read_mcp_config(&config_path)?,
        vault_path,
        vault_paths,
        permission_mode,
    )?;
    std::fs::write(agent_dir.join("mcp.json"), config)
        .map_err(|error| format!("Failed to write Pi MCP config: {error}"))
}

fn read_mcp_config(config_path: &Path) -> Result<Value, String> {
    match std::fs::read_to_string(config_path) {
        Ok(contents) if contents.trim().is_empty() => Ok(Value::Object(Map::new())),
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("Failed to parse existing Pi MCP config: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(error) => Err(format!("Failed to read existing Pi MCP config: {error}")),
    }
}

#[cfg(test)]
fn build_mcp_config(
    vault_path: &str,
    vault_paths: &[String],
    permission_mode: AiAgentPermissionMode,
) -> Result<String, String> {
    build_mcp_config_from_base(
        Value::Object(Map::new()),
        vault_path,
        vault_paths,
        permission_mode,
    )
}

fn build_mcp_config_from_base(
    mut config: Value,
    vault_path: &str,
    vault_paths: &[String],
    _permission_mode: AiAgentPermissionMode,
) -> Result<String, String> {
    let mcp_server = tolaria_mcp_server_config(vault_path, vault_paths)?;
    let root = ensure_object(&mut config);
    let settings = ensure_child_object(root, "settings");
    settings.insert("toolPrefix".into(), Value::String("none".into()));
    settings.insert("idleTimeout".into(), Value::Number(10.into()));
    let servers = ensure_child_object(root, "mcpServers");
    servers.insert("tolaria".into(), mcp_server);

    serde_json::to_string(&config)
        .map_err(|error| format!("Failed to serialize Pi MCP config: {error}"))
}

fn tolaria_mcp_server_config(vault_path: &str, vault_paths: &[String]) -> Result<Value, String> {
    let mcp_server_path = crate::cli_agent_runtime::mcp_server_path_string()?;
    let vault_paths = crate::cli_agent_runtime::active_vault_paths_json(vault_path, vault_paths);

    Ok(serde_json::json!({
        "command": "node",
        "args": [mcp_server_path],
        "env": {
            "VAULT_PATH": vault_path,
            "VAULT_PATHS": vault_paths,
            "WS_UI_PORT": "9711"
        },
        "lifecycle": "lazy",
        "directTools": true
    }))
}

fn ensure_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    match value {
        Value::Object(object) => object,
        _ => unreachable!("value was normalized to an object"),
    }
}

fn ensure_child_object<'a>(
    object: &'a mut Map<String, Value>,
    key: &str,
) -> &'a mut Map<String, Value> {
    let value = object
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    ensure_object(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::path::PathBuf;
    use std::sync::Mutex;

    static PI_AGENT_ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        key: &'static str,
        previous: Option<std::ffi::OsString>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    fn request() -> AgentStreamRequest {
        AgentStreamRequest {
            message: "Rename the note".into(),
            system_prompt: None,
            vault_path: "/tmp/vault".into(),
            vault_paths: Vec::new(),
            permission_mode: crate::ai_agents::AiAgentPermissionMode::Safe,
        }
    }

    #[test]
    fn args_use_documented_json_mode_with_mcp_adapter() {
        let args = build_args();

        assert_pi_json_mode_args(&args);
        assert!(args.contains(&"npm:pi-mcp-adapter".to_string()));
        assert!(!args.contains(&"--no-tools".to_string()));
    }

    fn assert_pi_json_mode_args(args: &[String]) {
        assert_eq!(
            (
                args.first().map(String::as_str),
                args.get(1).map(String::as_str),
                args.iter().any(|arg| arg == "--no-session"),
                args.iter().any(|arg| arg == "--extension"),
            ),
            (Some("--mode"), Some("json"), true, true)
        );
    }

    #[test]
    fn command_sets_vault_cwd_closed_stdin_and_config_dir() {
        let _env_lock = PI_AGENT_ENV_LOCK.lock().unwrap();
        let source_agent_dir = tempfile::tempdir().unwrap();
        let agent_dir = tempfile::tempdir().unwrap();
        let _guard = EnvGuard::set("PI_CODING_AGENT_DIR", source_agent_dir.path());
        let command = build_command(&PathBuf::from("pi"), &request(), agent_dir.path()).unwrap();
        let actual_args: Vec<&OsStr> = command.get_args().collect();
        let config_dir = command
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("PI_CODING_AGENT_DIR"))
            .and_then(|(_, value)| value);

        assert_command_identity(&command, &actual_args);
        assert_command_vault_scope(&command, config_dir, agent_dir.path());
    }

    fn assert_command_identity(command: &std::process::Command, actual_args: &[&OsStr]) {
        assert_eq!(
            (
                command.get_program(),
                actual_args.first().copied(),
                actual_args.get(1).copied(),
                actual_args.last().copied(),
            ),
            (
                OsStr::new("pi"),
                Some(OsStr::new("--mode")),
                Some(OsStr::new("json")),
                Some(OsStr::new("Rename the note")),
            )
        );
    }

    fn assert_command_vault_scope(
        command: &std::process::Command,
        config_dir: Option<&OsStr>,
        agent_dir: &Path,
    ) {
        assert_eq!(command.get_current_dir(), Some(Path::new("/tmp/vault")));
        assert_eq!(config_dir, Some(agent_dir.as_os_str()));
        assert!(agent_dir.join("mcp.json").exists());
    }

    #[test]
    fn command_avoids_windows_cmd_shim_for_prompt_args() {
        let _env_lock = PI_AGENT_ENV_LOCK.lock().unwrap();
        let source_agent_dir = tempfile::tempdir().unwrap();
        let agent_dir = tempfile::tempdir().unwrap();
        let _guard = EnvGuard::set("PI_CODING_AGENT_DIR", source_agent_dir.path());
        let shim = agent_dir.path().join("pi.cmd");
        let launcher = agent_dir
            .path()
            .join("node_modules")
            .join("@withpi")
            .join("pi")
            .join("bin")
            .join("pi.exe");
        std::fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        std::fs::write(&launcher, "native pi launcher").unwrap();
        std::fs::write(
            &shim,
            r#"@ECHO off
"%~dp0\node_modules\@withpi\pi\bin\pi.exe" %*
"#,
        )
        .unwrap();

        let command = build_command(&shim, &request(), agent_dir.path()).unwrap();
        let actual_args = command.get_args().collect::<Vec<_>>();

        assert_eq!(
            (
                command.get_program() != shim.as_os_str(),
                command.get_program(),
                actual_args.first().copied(),
                actual_args.last().copied(),
            ),
            (
                true,
                launcher.as_os_str(),
                Some(OsStr::new("--mode")),
                Some(OsStr::new("Rename the note")),
            ),
            "Pi npm .cmd shims cannot be spawned directly on Windows"
        );
    }

    #[test]
    fn command_seeds_temp_agent_dir_from_existing_pi_config() {
        let _env_lock = PI_AGENT_ENV_LOCK.lock().unwrap();
        let source_agent_dir = tempfile::tempdir().unwrap();
        let agent_dir = tempfile::tempdir().unwrap();
        write_existing_pi_config(source_agent_dir.path());
        let _guard = EnvGuard::set("PI_CODING_AGENT_DIR", source_agent_dir.path());

        let command = build_command(&PathBuf::from("pi"), &request(), agent_dir.path()).unwrap();
        let config_dir = command
            .get_envs()
            .find(|(key, _)| *key == OsStr::new("PI_CODING_AGENT_DIR"))
            .and_then(|(_, value)| value)
            .unwrap();

        assert_eq!(config_dir, agent_dir.path().as_os_str());
        assert_seeded_pi_config_files(agent_dir.path());
        assert_seeded_pi_mcp_config(read_mcp_config_value(agent_dir.path()));
    }

    fn write_existing_pi_config(source_agent_dir: &Path) {
        std::fs::write(
            source_agent_dir.join("auth.json"),
            r#"{"openai":{"type":"api_key","key":"OPENAI_API_KEY"}}"#,
        )
        .unwrap();
        std::fs::write(
            source_agent_dir.join("settings.json"),
            r#"{"defaultProvider":"openai","defaultModel":"gpt-5.1","settingsOnly":true}"#,
        )
        .unwrap();
        std::fs::write(
            source_agent_dir.join("mcp.json"),
            r#"{"imports":["codex"],"mcpServers":{"personal":{"command":"personal-mcp"}}}"#,
        )
        .unwrap();
    }

    fn assert_seeded_pi_config_files(agent_dir: &Path) {
        assert_eq!(
            std::fs::read_to_string(agent_dir.join("auth.json")).unwrap(),
            r#"{"openai":{"type":"api_key","key":"OPENAI_API_KEY"}}"#
        );
        assert_eq!(
            std::fs::read_to_string(agent_dir.join("settings.json")).unwrap(),
            r#"{"defaultProvider":"openai","defaultModel":"gpt-5.1","settingsOnly":true}"#
        );
    }

    fn read_mcp_config_value(agent_dir: &Path) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(agent_dir.join("mcp.json")).unwrap()).unwrap()
    }

    fn assert_seeded_pi_mcp_config(mcp: serde_json::Value) {
        assert_eq!(mcp["imports"][0], "codex");
        assert_eq!(mcp["mcpServers"]["personal"]["command"], "personal-mcp");
        assert_eq!(
            mcp["mcpServers"]["tolaria"]["env"]["VAULT_PATH"],
            "/tmp/vault"
        );
    }

    #[test]
    fn seeded_settings_rewrite_relative_packages_against_source_dir() {
        let source_agent_dir = tempfile::tempdir().unwrap();
        let agent_dir = tempfile::tempdir().unwrap();
        std::fs::write(
            source_agent_dir.path().join("settings.json"),
            r#"{"defaultProvider":"openai","packages":["npm:pi-mcp-adapter","../plugins/local-plugin","./inline-plugin","git:example/repo"]}"#,
        )
        .unwrap();

        seed_agent_dir(source_agent_dir.path(), agent_dir.path()).unwrap();

        let seeded = read_seeded_settings(agent_dir.path());
        assert_eq!(seeded["defaultProvider"], "openai");
        assert_rewritten_packages(&seeded["packages"], source_agent_dir.path());
    }

    fn read_seeded_settings(agent_dir: &Path) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(agent_dir.join("settings.json")).unwrap())
            .unwrap()
    }

    fn assert_rewritten_packages(packages: &serde_json::Value, source_dir: &Path) {
        let sibling = source_dir.parent().unwrap().join("plugins/local-plugin");
        let inline = source_dir.join("inline-plugin");
        assert_eq!(
            packages,
            &serde_json::json!([
                "npm:pi-mcp-adapter",
                sibling.to_string_lossy(),
                inline.to_string_lossy(),
                "git:example/repo",
            ])
        );
    }

    #[test]
    fn malformed_seeded_settings_are_copied_verbatim() {
        let source_agent_dir = tempfile::tempdir().unwrap();
        let agent_dir = tempfile::tempdir().unwrap();
        std::fs::write(source_agent_dir.path().join("settings.json"), "not json{").unwrap();

        seed_agent_dir(source_agent_dir.path(), agent_dir.path()).unwrap();

        assert_eq!(
            std::fs::read_to_string(agent_dir.path().join("settings.json")).unwrap(),
            "not json{"
        );
    }

    #[test]
    fn stale_pi_agent_config_entry_is_ignored() {
        let source_agent_dir = tempfile::tempdir().unwrap();
        let agent_dir = tempfile::tempdir().unwrap();
        let stale_source = source_agent_dir.path().join("stale.json");
        let target = agent_dir.path().join("stale.json");

        copy_agent_entry(&stale_source, &target).unwrap();

        assert!(!target.exists());
    }

    #[test]
    fn mcp_config_includes_tolaria_server_for_active_vault() {
        if let Ok(config) = build_mcp_config(
            "/tmp/vault",
            &[],
            crate::ai_agents::AiAgentPermissionMode::Safe,
        ) {
            let json: serde_json::Value = serde_json::from_str(&config).unwrap();
            assert_base_mcp_config(&json);
            assert_tolaria_mcp_env(&json);
            assert_tolaria_mcp_args(&json);
        }
    }

    fn assert_base_mcp_config(json: &serde_json::Value) {
        assert_eq!(
            (
                &json["settings"]["toolPrefix"],
                &json["mcpServers"]["tolaria"]["command"],
                &json["mcpServers"]["tolaria"]["lifecycle"],
                &json["mcpServers"]["tolaria"]["directTools"],
            ),
            (
                &serde_json::json!("none"),
                &serde_json::json!("node"),
                &serde_json::json!("lazy"),
                &serde_json::json!(true),
            )
        );
    }

    fn assert_tolaria_mcp_env(json: &serde_json::Value) {
        assert_eq!(
            json["mcpServers"]["tolaria"]["env"]["VAULT_PATH"],
            "/tmp/vault"
        );
        assert_eq!(
            json["mcpServers"]["tolaria"]["env"]["VAULT_PATHS"],
            r#"["/tmp/vault"]"#
        );
        assert_eq!(json["mcpServers"]["tolaria"]["env"]["WS_UI_PORT"], "9711");
    }

    fn assert_tolaria_mcp_args(json: &serde_json::Value) {
        assert!(json["mcpServers"]["tolaria"]["args"][0]
            .as_str()
            .unwrap()
            .ends_with("index.js"));
    }

    #[test]
    fn power_user_mode_uses_the_same_pi_mcp_config_as_safe_mode() {
        let safe = build_mcp_config(
            "/tmp/vault",
            &[],
            crate::ai_agents::AiAgentPermissionMode::Safe,
        )
        .unwrap();
        let power = build_mcp_config(
            "/tmp/vault",
            &[],
            crate::ai_agents::AiAgentPermissionMode::PowerUser,
        )
        .unwrap();

        assert_eq!(safe, power);
    }

    #[test]
    fn prompt_keeps_system_prompt_first() {
        let prompt = build_prompt(&AgentStreamRequest {
            system_prompt: Some("Be concise".into()),
            ..request()
        });

        assert!(prompt.starts_with("System instructions:\nBe concise"));
        assert!(prompt.contains("User request:\nRename the note"));
    }
}
