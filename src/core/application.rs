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

/// Service tier that controls startup ordering and management policy.
///
/// ```yaml
/// tier: 0   # always-on; pulse itself / Redis
/// tier: 1   # pinned; started by pulse at boot (identity, persona)
/// tier: 2   # on-demand; started lazily on first request (default)
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Default)]
pub struct Tier(pub u8);

impl Tier {
    /// Control-plane tier: always on, must never depend on higher tiers.
    pub const CONTROL: Tier = Tier(0);
    /// Pinned tier: auto-started at pulse boot, in dependency order.
    pub const PINNED: Tier = Tier(1);
    /// On-demand tier: cold-started by the proxy on first request.
    pub const ON_DEMAND: Tier = Tier(2);
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
    /// Service tier (0 = control-plane, 1 = pinned, 2 = on-demand).
    /// Defaults to `Tier::ON_DEMAND` (2) when not set.
    #[serde(default = "default_tier")]
    pub tier: Tier,
}

fn default_tier() -> Tier {
    Tier::ON_DEMAND
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

    /// Returns true if this service is pinned (tier = 1) and should never be
    /// idle-stopped or left cold.
    pub fn is_pinned(&self) -> bool {
        self.tier == Tier::PINNED
    }

    /// Returns true if this service is CONTROL (tier = 0) and should never be
    /// idle-stopped or left cold.
    pub fn is_control(&self) -> bool {
        self.tier == Tier::CONTROL
    }

}
