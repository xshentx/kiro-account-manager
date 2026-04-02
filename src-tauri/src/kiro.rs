// Kiro IDE 相关功能

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

// ===== 辅助函数 =====

/// 根据 startUrl 计算 clientIdHash（与 Kiro IDE 源码一致）
fn calculate_client_id_hash(start_url: &str) -> String {
    let input = format!(r#"{{"startUrl":"{start_url}"}}"#);
    let mut hasher = Sha1::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

// ===== Kiro IDE 本地 Token =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroLocalToken {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
    pub auth_method: Option<String>,
    pub provider: Option<String>,
    // Social 专用
    pub profile_arn: Option<String>,
    // IdC 专用
    pub client_id_hash: Option<String>,
    pub region: Option<String>,
    // 注意：Kiro IDE 不在 kiro-auth-token.json 中存储 startUrl
    // startUrl 包含在 clientSecret JWT 的 initiateLoginUri 字段中
}

/// `IdC` 客户端注册信息 (从 {clientIdHash}.json 读取)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientRegistration {
    pub client_id: String,
    pub client_secret: String,
    pub expires_at: Option<String>,
}

#[tauri::command]
pub async fn get_kiro_local_token() -> Option<KiroLocalToken> {
    tokio::task::spawn_blocking(|| {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        let path = std::path::Path::new(&home)
            .join(".aws")
            .join("sso")
            .join("cache")
            .join("kiro-auth-token.json");

        let content = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    })
    .await
    .ok()
    .flatten()
}

/// 读取 `IdC` 客户端注册信息
pub async fn get_client_registration(client_id_hash: &str) -> Option<ClientRegistration> {
    let hash = client_id_hash.to_string();
    tokio::task::spawn_blocking(move || {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        let path = std::path::Path::new(&home)
            .join(".aws")
            .join("sso")
            .join("cache")
            .join(format!("{hash}.json"));

        let content = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    })
    .await
    .ok()
    .flatten()
}

// ===== 从 Kiro IDE 导入账号 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroAccountInfo {
    pub email: String,
    pub provider: String,
    pub auth_method: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
    // Social 专用
    pub profile_arn: Option<String>,
    // IdC 专用
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub client_id_hash: Option<String>,
    pub region: Option<String>,
    // 注意：不需要 start_url 字段
    // startUrl 包含在 clientSecret JWT 的 initiateLoginUri 字段中
    // AWS SSO OIDC API 会自动从 JWT 中解析
}

/// 读取 Kiro IDE 中的所有账号
#[tauri::command]
pub async fn read_kiro_accounts() -> Result<Vec<KiroAccountInfo>, String> {
    tokio::task::spawn_blocking(|| {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| "无法获取用户目录")?;

        let cache_dir = std::path::Path::new(&home)
            .join(".aws")
            .join("sso")
            .join("cache");

        if !cache_dir.exists() {
            return Err("未找到 Kiro IDE 缓存目录".to_string());
        }

        let mut accounts = Vec::new();

        // 读取主 token 文件
        let token_path = cache_dir.join("kiro-auth-token.json");
        if token_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&token_path) {
                if let Ok(token) = serde_json::from_str::<KiroLocalToken>(&content) {
                    let auth_method = token.auth_method.as_deref().unwrap_or("social");
                    let provider = token
                        .provider
                        .clone()
                        .unwrap_or_else(|| "Google".to_string());

                    let mut account = KiroAccountInfo {
                        email: String::new(), // 需要通过 API 获取
                        provider: provider.clone(),
                        auth_method: auth_method.to_string(),
                        access_token: token.access_token.clone(),
                        refresh_token: token.refresh_token.clone(),
                        expires_at: token.expires_at.clone(),
                        profile_arn: token.profile_arn.clone(),
                        client_id: None,
                        client_secret: None,
                        client_id_hash: token.client_id_hash.clone(),
                        region: token.region.clone(),
                    };

                    // 如果是 IdC 账号，读取 client registration
                    if auth_method == "IdC" {
                        if let Some(ref hash) = token.client_id_hash {
                            let client_path = cache_dir.join(format!("{hash}.json"));
                            if let Ok(client_content) = std::fs::read_to_string(&client_path) {
                                if let Ok(client_reg) =
                                    serde_json::from_str::<ClientRegistration>(&client_content)
                                {
                                    account.client_id = Some(client_reg.client_id);
                                    account.client_secret = Some(client_reg.client_secret);
                                }
                            }
                        }
                    }

                    accounts.push(account);
                }
            }
        }

        if accounts.is_empty() {
            return Err("未找到 Kiro IDE 账号，请先在 Kiro IDE 中登录".to_string());
        }

        Ok(accounts)
    })
    .await
    .map_err(|e| format!("读取失败: {e}"))?
}

// ===== 切换账号 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchAccountResult {
    pub success: bool,
    pub message: String,
}

/// 切换账号参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchAccountParams {
    pub access_token: String,
    pub refresh_token: String,
    pub provider: String,
    #[serde(default)]
    pub auth_method: Option<String>,
    // Social 专用
    #[serde(default)]
    pub profile_arn: Option<String>,
    // IdC 专用
    #[serde(default)]
    pub start_url: Option<String>, // Enterprise 必须提供，BuilderId 不需要
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
}

/// 切换 Kiro 账号（原子写入 Token 文件，无需重启 IDE）
#[tauri::command]
pub async fn switch_kiro_account(
    params: SwitchAccountParams,
) -> Result<SwitchAccountResult, String> {
    tokio::task::spawn_blocking(move || {
        let auth_method = params.auth_method.unwrap_or_else(|| "social".to_string());
        let access_token = params.access_token;
        let refresh_token = params.refresh_token;
        let provider = params.provider;
        let profile_arn = params.profile_arn;
        let start_url = params.start_url;
        let client_id = params.client_id;
        let client_secret = params.client_secret;
        let region = params.region;

        // 获取 token 目录
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| "Cannot find home directory")?;

        let dir_path = std::path::Path::new(&home)
            .join(".aws")
            .join("sso")
            .join("cache");

        std::fs::create_dir_all(&dir_path)
            .map_err(|e| format!("Failed to create directory: {e}"))?;

        let file_path = dir_path.join("kiro-auth-token.json");
        let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);

        // 根据 auth_method 构建 token 数据
        let token_data = if auth_method == "IdC" {
            // 确定 startUrl
            let actual_start_url = if provider == "BuilderId" {
                "https://view.awsapps.com/start".to_string()
            } else if provider == "Enterprise" {
                start_url
                    .clone()
                    .ok_or("Enterprise 账号必须提供 start_url")?
            } else {
                return Err(format!("未知的 IdC Provider: {provider}"));
            };

            // 计算 clientIdHash
            let hash = calculate_client_id_hash(&actual_start_url);

            serde_json::json!({
                "accessToken": access_token,
                "refreshToken": refresh_token,
                "expiresAt": expires_at.to_rfc3339(),
                "authMethod": "IdC",
                "provider": provider,
                "clientIdHash": hash,
                "region": region.ok_or("IdC 账号必须提供 region")?,
            })
        } else {
            let arn = profile_arn.unwrap_or_else(|| {
                "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK".to_string()
            });
            serde_json::json!({
                "accessToken": access_token,
                "refreshToken": refresh_token,
                "profileArn": arn,
                "expiresAt": expires_at.to_rfc3339(),
                "authMethod": "social",
                "provider": provider
            })
        };

        let content = serde_json::to_string_pretty(&token_data)
            .map_err(|e| format!("Failed to serialize: {e}"))?;

        // 原子写入：先写临时文件，再 rename
        let temp_file_path = dir_path.join("kiro-auth-token.json.tmp");
        std::fs::write(&temp_file_path, &content)
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        std::fs::rename(&temp_file_path, &file_path)
            .map_err(|e| format!("Failed to rename file: {e}"))?;

        // IdC 账号还需要写入 Client Registration 文件
        if auth_method == "IdC" {
            if let (Some(cid), Some(csec)) = (client_id, client_secret) {
                // 确定 startUrl
                let actual_start_url = if provider == "BuilderId" {
                    "https://view.awsapps.com/start".to_string()
                } else if provider == "Enterprise" {
                    start_url.ok_or("Enterprise 账号必须提供 start_url")?
                } else {
                    return Err(format!("未知的 IdC Provider: {provider}"));
                };

                // 计算 clientIdHash
                let hash = calculate_client_id_hash(&actual_start_url);

                let client_reg_path = dir_path.join(format!("{hash}.json"));
                let client_reg_temp_path = dir_path.join(format!("{hash}.json.tmp"));
                let client_expires = chrono::Utc::now() + chrono::Duration::days(90);
                let client_reg_data = serde_json::json!({
                    "clientId": cid,
                    "clientSecret": csec,
                    "expiresAt": client_expires.to_rfc3339()
                });
                let client_reg_content = serde_json::to_string_pretty(&client_reg_data)
                    .map_err(|e| format!("Failed to serialize client registration: {e}"))?;
                std::fs::write(&client_reg_temp_path, client_reg_content)
                    .map_err(|e| format!("Failed to write client registration temp: {e}"))?;
                std::fs::rename(&client_reg_temp_path, &client_reg_path)
                    .map_err(|e| format!("Failed to rename client registration: {e}"))?;
            } else {
                return Err("IdC 账号必须提供 client_id 和 client_secret".to_string());
            }
        }

        Ok(SwitchAccountResult {
            success: true,
            message: format!("Switched to {provider} ({auth_method}) account"),
        })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}
