use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};
use tower_http::cors::{Any, CorsLayer};

use super::handlers::*;
use crate::lifecycle::manager::LifeCycleManager;

pub fn build(engine: Arc<LifeCycleManager>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(server_health))
        .route("/applications", get(list_applications))
        .route("/applications/:id", get(get_application))
        .route("/applications/:id/start", post(start_application))
        .route("/applications/:id/stop", post(stop_application))
        .route("/applications/:id/restart", post(restart_application))
        .with_state(engine)
        .layer(cors)
}
