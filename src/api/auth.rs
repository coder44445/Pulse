use axum::{
    body::Body,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub fn get_admin_key() -> String {
    std::env::var("PULSE_ADMIN_KEY").unwrap_or_else(|_| "pulse-admin-secret".to_string())
}

pub fn validate_admin_key(header_val: Option<&str>) -> bool {
    let expected = get_admin_key();
    if expected.is_empty() {
        return true; // Empty key disables auth (unrestricted dev mode)
    }

    match header_val {
        Some(val) => {
            let key = val.strip_prefix("Bearer ").unwrap_or(val);
            key.trim() == expected.trim()
        }
        None => false,
    }
}

pub async fn require_admin_key(
    req: Request<Body>,
    next: Next,
) -> Result<Response, Response> {
    let header_opt = req
        .headers()
        .get("x-pulse-admin-key")
        .or_else(|| req.headers().get("authorization"))
        .and_then(|h| h.to_str().ok());

    if validate_admin_key(header_opt) {
        Ok(next.run(req).await)
    } else {
        let body = Json(json!({
            "error": "Unauthorized",
            "message": "Valid X-Pulse-Admin-Key or Authorization Bearer header required for lifecycle operations"
        }));
        Err((StatusCode::UNAUTHORIZED, body).into_response())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_admin_key() {
        // With default key "pulse-admin-secret"
        assert!(validate_admin_key(Some("pulse-admin-secret")));
        assert!(validate_admin_key(Some("Bearer pulse-admin-secret")));
        assert!(!validate_admin_key(Some("wrong-secret")));
        assert!(!validate_admin_key(None));
    }
}
