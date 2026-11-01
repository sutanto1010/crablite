use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

pub const SESSION_COOKIE_NAME: &str = "crablite_session";
pub const SESSION_TTL_SECS: u64 = 30 * 24 * 3600; // 30 days

#[derive(Serialize)]
pub struct AuthConfigResponse {
    pub turnstile_enabled: bool,
    pub turnstile_site_key: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub api_key: String,
    pub turnstile_token: Option<String>,
}

#[derive(Deserialize)]
struct TurnstileVerifyResponse {
    success: bool,
    #[serde(rename = "error-codes")]
    error_codes: Option<Vec<String>>,
}

pub fn sign_payload(payload: &str, secret: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC can take key of any size");
    mac.update(payload.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub fn create_session_cookie(secret: &[u8], ttl_secs: u64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let exp = now + ttl_secs;
    let payload = exp.to_string();
    let sig = sign_payload(&payload, secret);
    format!(
        "{SESSION_COOKIE_NAME}={payload}.{sig}; HttpOnly; Path=/; Max-Age={ttl_secs}; SameSite=Lax"
    )
}

pub fn verify_session_cookie(cookie_header: &str, secret: &[u8]) -> bool {
    let target = format!("{SESSION_COOKIE_NAME}=");
    for cookie in cookie_header.split(';') {
        let trimmed = cookie.trim();
        if let Some(cookie_val) = trimmed.strip_prefix(&target) {
            let parts: Vec<&str> = cookie_val.split('.').collect();
            if parts.len() != 2 {
                return false;
            }
            let exp_str = parts[0];
            let sig_hex = parts[1];

            let exp: u64 = match exp_str.parse() {
                Ok(v) => v,
                Err(_) => return false,
            };

            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            if exp <= now {
                return false;
            }

            let mut mac = match HmacSha256::new_from_slice(secret) {
                Ok(m) => m,
                Err(_) => return false,
            };
            mac.update(exp_str.as_bytes());

            let sig_bytes = match hex::decode(sig_hex) {
                Ok(b) => b,
                Err(_) => return false,
            };

            if mac.verify_slice(&sig_bytes).is_ok() {
                return true;
            }
        }
    }
    false
}

pub async fn get_auth_config(State(state): State<AppState>) -> Json<AuthConfigResponse> {
    let turnstile_enabled =
        state.turnstile_secret_key.is_some() && state.turnstile_site_key.is_some();
    Json(AuthConfigResponse {
        turnstile_enabled,
        turnstile_site_key: state.turnstile_site_key.clone(),
    })
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    if payload.api_key != state.api_key {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid API key" })),
        ));
    }

    let turnstile_enabled =
        state.turnstile_secret_key.is_some() && state.turnstile_site_key.is_some();

    if turnstile_enabled {
        let secret = state.turnstile_secret_key.as_deref().unwrap();
        let token = match payload.turnstile_token.as_deref().map(str::trim) {
            Some(t) if !t.is_empty() => t,
            _ => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Turnstile verification required" })),
                ));
            }
        };

        let mut body = json!({
            "secret": secret,
            "response": token,
        });

        // Forward client IP if available
        let client_ip = headers
            .get("cf-connecting-ip")
            .or_else(|| headers.get("x-forwarded-for"))
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .map(str::trim);

        if let Some(ip) = client_ip {
            body["remoteip"] = json!(ip);
        }

        let verify_res = state
            .http_client
            .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
            .json(&body)
            .send()
            .await;

        match verify_res {
            Ok(resp) => {
                match resp.json::<TurnstileVerifyResponse>().await {
                    Ok(body) => {
                        if !body.success {
                            tracing::warn!(
                                "Turnstile verification failed: {:?}",
                                body.error_codes
                            );
                            return Err((
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "error": "Turnstile challenge failed" })),
                            ));
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to parse Turnstile response: {}", e);
                        return Err((
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "Failed to verify Turnstile challenge" })),
                        ));
                    }
                }
            }
            Err(e) => {
                tracing::error!("Error contacting Turnstile verification server: {}", e);
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to reach Turnstile verification server" })),
                ));
            }
        }
    }

    let cookie = create_session_cookie(&state.session_secret, SESSION_TTL_SECS);
    let mut response = Json(json!({ "success": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        cookie.parse().map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to generate cookie" })),
            )
        })?,
    );

    Ok(response)
}

pub async fn logout() -> Response {
    let mut response = Json(json!({ "success": true })).into_response();
    let clear_cookie = format!(
        "{SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
    );
    if let Ok(val) = clear_cookie.parse() {
        response.headers_mut().insert(header::SET_COOKIE, val);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_cookie_creation_and_verification() {
        let secret = b"my-super-test-secret-12345";
        let cookie_str = create_session_cookie(secret, 3600);
        assert!(cookie_str.contains("crablite_session="));
        assert!(cookie_str.contains("HttpOnly"));

        // Extract cookie header value as sent by browser: "crablite_session=..."
        let cookie_val = cookie_str.split(';').next().unwrap();
        assert!(verify_session_cookie(cookie_val, secret));

        // Test with multiple cookies in header
        let full_header = format!("theme=dark; {}; other=123", cookie_val);
        assert!(verify_session_cookie(&full_header, secret));

        // Wrong secret
        let wrong_secret = b"wrong-secret-key-123456";
        assert!(!verify_session_cookie(cookie_val, wrong_secret));

        // Tampered payload
        let tampered = format!("{cookie_val}tampered");
        assert!(!verify_session_cookie(&tampered, secret));

        // Tampered exp
        let parts: Vec<&str> = cookie_val.split('.').collect();
        let tampered_exp = format!("crablite_session=9999999999.{}", parts[1]);
        assert!(!verify_session_cookie(&tampered_exp, secret));
    }

    #[tokio::test]
    async fn test_login_and_logout_handlers() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let state = AppState::for_test(pool);

        // 1. Config endpoint
        let config_res = get_auth_config(State(state.clone())).await;
        assert!(!config_res.turnstile_enabled);
        assert_eq!(config_res.turnstile_site_key, None);

        // 2. Wrong API key
        let wrong_login = login(
            State(state.clone()),
            HeaderMap::new(),
            Json(LoginRequest {
                api_key: "wrong-key".to_string(),
                turnstile_token: None,
            }),
        )
        .await;
        assert!(wrong_login.is_err());
        assert_eq!(wrong_login.unwrap_err().0, StatusCode::UNAUTHORIZED);

        // 3. Correct API key (Turnstile disabled)
        let correct_login = login(
            State(state.clone()),
            HeaderMap::new(),
            Json(LoginRequest {
                api_key: "test-api-key".to_string(),
                turnstile_token: None,
            }),
        )
        .await;
        assert!(correct_login.is_ok());
        let res = correct_login.unwrap();
        let set_cookie = res.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap();
        assert!(set_cookie.contains("crablite_session="));
        assert!(set_cookie.contains("HttpOnly"));

        // 4. Logout clears cookie
        let logout_res = logout().await;
        let clear_cookie = logout_res.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap();
        assert!(clear_cookie.contains("Max-Age=0"));
    }
}
