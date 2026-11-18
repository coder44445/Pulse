use crate::lifecycle::manager::{AppDetail, AppSummary, LifeCycleManager};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;

pub async fn list_applications(
    State(engine): State<Arc<LifeCycleManager>>,
) -> Result<Json<Vec<AppSummary>>, (StatusCode, String)> {
    engine
        .list_applications_with_status()
        .await
        .map(Json)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to list applications: {e}"),
            )
        })
}

pub async fn get_application(
    State(engine): State<Arc<LifeCycleManager>>,
    Path(id): Path<String>,
) -> Result<Json<AppDetail>, (StatusCode, String)> {
    engine.get_app_detail(&id).await.map(Json).map_err(|e| {
        if e.to_string().contains("app not found") {
            (StatusCode::NOT_FOUND, format!("application '{id}' not found"))
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to get application: {e}"),
            )
        }
    })
}


async fn handle_lifecycle(
    id: &str,
    action: &str,
    fut: impl std::future::Future<Output = anyhow::Result<()>>,
) -> Result<StatusCode, (StatusCode, String)> {
    fut.await.map_err(|e| {
        eprintln!("[pulse] {action} '{id}' failed: {e:?}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("{action} failed: {e}"),
        )
    })?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn start_application(
    State(engine): State<Arc<LifeCycleManager>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_lifecycle(&id, "start", engine.start(&id)).await
}

pub async fn stop_application(
    State(engine): State<Arc<LifeCycleManager>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_lifecycle(&id, "stop", engine.stop(&id)).await
}

pub async fn restart_application(
    State(engine): State<Arc<LifeCycleManager>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_lifecycle(&id, "restart", engine.restart(&id)).await
}


pub async fn server_health() -> StatusCode {
    StatusCode::OK
}

pub async fn verify_admin_key(
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let header_opt = headers
        .get("x-pulse-admin-key")
        .or_else(|| headers.get("authorization"))
        .and_then(|h| h.to_str().ok());

    if super::auth::validate_admin_key(header_opt) {
        Ok(Json(serde_json::json!({
            "status": "ok",
            "role": "admin",
            "message": "Admin authenticated successfully"
        })))
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": "Unauthorized",
                "message": "Invalid or missing admin key"
            })),
        ))
    }
}
