use super::stack::Stack;
use serde::Deserialize;
use std::collections::HashMap;

/// Top-level `health:` block from app.yaml.
/// ```yaml
/// health:
///   backend: http://localhost:8000/health
/// ```
#[derive(Debug, Clone, Deserialize, Default)]
pub struct HealthConfig {
    /// URL polled to know when the backend is ready.
    pub backend: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Application {
    pub name: String,
    pub stacks: HashMap<String, Stack>,
    #[serde(default)]
    pub dependencies: Option<Vec<String>>,
    #[serde(default)]
    pub routes: Vec<String>,
    #[serde(default)]
    pub idle_timeout: Option<String>,
    /// App-level health check config (used by lifecycle manager and proxy).
    #[serde(default)]
    pub health: HealthConfig,
}

impl Application {
    pub fn parsed_idle_timeout(&self) -> Option<std::time::Duration> {
        let timeout_str = self.idle_timeout.as_deref()?;
        let mut num = String::new();
        let mut unit = String::new();

        for c in timeout_str.chars() {
            if c.is_ascii_digit() {
                num.push(c);
            } else if c.is_alphabetic() {
                unit.push(c);
            }
        }

        let val: u64 = num.parse().ok()?;
        match unit.as_str() {
            "s" | "sec" | "secs" => Some(std::time::Duration::from_secs(val)),
            "m" | "min" | "mins" => Some(std::time::Duration::from_secs(val * 60)),
            "h" | "hr" | "hrs" => Some(std::time::Duration::from_secs(val * 3600)),
            _ => None, // Unsupported unit or empty
        }
    }
}
