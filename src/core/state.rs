#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Starting,
    Stopped,
    HealthCheck,
    Running,
    Idle,
    Stopping,
    Failed,
}
