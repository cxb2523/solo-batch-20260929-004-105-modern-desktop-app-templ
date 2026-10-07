use serde::Serialize;

/// Structured command error: the frontend receives `{ code, message }` and can
/// branch on `code` instead of parsing a free-form string.
#[derive(Debug, Clone, Serialize)]
pub struct CommandError {
  pub code: String,
  pub message: String,
}

impl CommandError {
  pub fn new(code: &str, message: impl Into<String>) -> Self {
    CommandError {
      code: code.into(),
      message: message.into(),
    }
  }
}

impl std::fmt::Display for CommandError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "[{}] {}", self.code, self.message)
  }
}

impl std::error::Error for CommandError {}

/// New-style command: errors are structured (`{ code, message }`).
///
/// Error branches (driven by `filepath` so the IPC inspector can trigger them):
/// - empty/blank path      -> code `EMPTY_FILEPATH`
/// - path containing "forbidden" -> code `FORBIDDEN_PATH`
#[tauri::command]
pub fn process_file(filepath: String) -> Result<String, CommandError> {
  println!("Processing file: {}", filepath);
  let trimmed = filepath.trim();
  if trimmed.is_empty() {
    return Err(CommandError::new(
      "EMPTY_FILEPATH",
      "filepath must not be empty",
    ));
  }
  if trimmed.to_lowercase().contains("forbidden") {
    return Err(CommandError::new(
      "FORBIDDEN_PATH",
      format!("access to '{trimmed}' is denied by policy"),
    ));
  }
  Ok(format!("Hello from Rust! processed '{trimmed}'"))
}

/// Legacy-style command kept for comparison: errors are plain strings, so the
/// frontend can only match on message text.
#[tauri::command]
pub fn legacy_process_file(filepath: String) -> Result<String, String> {
  println!("Legacy processing file: {}", filepath);
  if filepath.trim().is_empty() {
    return Err("filepath must not be empty".into());
  }
  Ok(format!("Hello from Rust! processed '{filepath}'"))
}

/// Snapshot of one capability file, as compiled into the app.
#[derive(Serialize)]
pub struct CapabilitySnapshot {
  pub file: &'static str,
  pub identifier: String,
  pub description: Option<String>,
  pub windows: Vec<String>,
  pub permissions: Vec<serde_json::Value>,
}

fn parse_capability(file: &'static str, raw: &str) -> Result<CapabilitySnapshot, CommandError> {
  let value: serde_json::Value = serde_json::from_str(raw)
    .map_err(|e| CommandError::new("CAPABILITY_PARSE", format!("{file}: {e}")))?;
  Ok(CapabilitySnapshot {
    file,
    identifier: value["identifier"].as_str().unwrap_or_default().to_string(),
    description: value["description"].as_str().map(|s| s.to_string()),
    windows: value["windows"]
      .as_array()
      .map(|ws| {
        ws.iter()
          .filter_map(|w| w.as_str().map(|s| s.to_string()))
          .collect()
      })
      .unwrap_or_default(),
    permissions: value["permissions"].as_array().cloned().unwrap_or_default(),
  })
}

/// Returns the capability declarations actually compiled into this build.
/// Custom app commands like this one are not gated by capabilities, so adding
/// a new command never requires editing the window-level capability files.
#[tauri::command]
pub fn list_capabilities() -> Result<Vec<CapabilitySnapshot>, CommandError> {
  Ok(vec![
    parse_capability("main.json", include_str!("../capabilities/main.json"))?,
    parse_capability("fs.json", include_str!("../capabilities/fs.json"))?,
    parse_capability("plugins.json", include_str!("../capabilities/plugins.json"))?,
  ])
}
