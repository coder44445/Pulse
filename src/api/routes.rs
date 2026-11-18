use std::sync::Arc;

use axum::{
    middleware,
    routing::{get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};

use super::auth::require_admin_key;
use super::handlers::*;
use crate::lifecycle::manager::LifeCycleManager;

pub fn build(engine: Arc<LifeCycleManager>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Protected mutating routes — require X-Pulse-Admin-Key
    let control_routes = Router::new()
        .route("/applications/:id/start", post(start_application))
        .route("/applications/:id/stop", post(stop_application))
        .route("/applications/:id/restart", post(restart_application))
        .route_layer(middleware::from_fn(require_admin_key));

    // Public / Read-only routes
    let public_routes = Router::new()
        .route("/health", get(server_health))
        .route("/auth/verify", get(verify_admin_key).post(verify_admin_key))
        .route("/applications", get(list_applications))
        .route("/applications/:id", get(get_application));

    Router::new()
        .merge(public_routes)
        .merge(control_routes)
        .with_state(engine)
        .layer(cors)
}
