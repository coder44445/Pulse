use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Stack {
    pub compose: String,
    #[serde(default)]
    pub health: Option<String>,
}
