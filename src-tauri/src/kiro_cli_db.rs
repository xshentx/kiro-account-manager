use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Kiro CLI 账号数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KiroCliAccount {
    pub access_token: String,
    pub refresh_token: String,
    pub profile_arn: Option<String>,
    pub region: String,
    pub expires_at: Option<String>,
    pub scopes: Option<Vec<String>>,
    pub auth_method: String, // "social" 或 "IdC"
    pub token_key: String,   // 记录来源键名
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
}

/// Device Registration 数据（仅 AWS SSO OIDC）
#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceRegistration {
    pub client_id: String,
    pub client_secret: String,
    pub region: String,
}

/// 从 kiro-cli 数据库读取账号
pub fn read_kiro_cli_accounts(db_path: &str) -> Result<Vec<KiroCliAccount>, String> {
    // 检查文件是否存在
    if !Path::new(db_path).exists() {
        return Err(format!("数据库文件不存在: {db_path}"));
    }

    // 打开数据库（只读模式）
    let conn = Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("无法打开数据库: {e}"))?;

    let mut accounts = Vec::new();

    // 按优先级尝试读取 Token
    let token_keys = vec![
        "kirocli:social:token",
        "kirocli:odic:token",
        "codewhisperer:odic:token",
    ];

    for key in token_keys {
        if let Ok(mut account) = read_token_from_db(&conn, key) {
            // 如果是 IdC，尝试读取 Device Registration
            if account.auth_method == "IdC" {
                if let Ok(device_reg) = read_device_registration(&conn) {
                    account.client_id = Some(device_reg.client_id);
                    account.client_secret = Some(device_reg.client_secret);
                }
            }
            accounts.push(account);
            break; // 只导入第一个找到的账号
        }
    }

    if accounts.is_empty() {
        return Err("未找到有效的账号数据".to_string());
    }

    Ok(accounts)
}

/// 从数据库读取指定键的 Token
fn read_token_from_db(conn: &Connection, key: &str) -> SqliteResult<KiroCliAccount> {
    let mut stmt = conn.prepare("SELECT value FROM auth_kv WHERE key = ?1")?;
    let value: String = stmt.query_row([key], |row| row.get(0))?;

    // 解析 JSON
    let token_data: serde_json::Value =
        serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)?;

    // 提取字段
    let access_token = token_data["access_token"]
        .as_str()
        .ok_or(rusqlite::Error::InvalidQuery)?
        .to_string();

    let refresh_token = token_data["refresh_token"]
        .as_str()
        .ok_or(rusqlite::Error::InvalidQuery)?
        .to_string();

    let region = token_data["region"]
        .as_str()
        .unwrap_or("us-east-1")
        .to_string();

    let expires_at = token_data["expires_at"]
        .as_str()
        .map(std::string::ToString::to_string);

    let profile_arn = token_data["profile_arn"]
        .as_str()
        .map(std::string::ToString::to_string);

    let scopes = token_data["scopes"].as_array().map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(std::string::ToString::to_string))
            .collect()
    });

    // 判断认证类型
    let auth_method = if profile_arn.is_some() {
        "social".to_string()
    } else if scopes.is_some() {
        "IdC".to_string()
    } else {
        "unknown".to_string()
    };

    Ok(KiroCliAccount {
        access_token,
        refresh_token,
        profile_arn,
        region,
        expires_at,
        scopes,
        auth_method,
        token_key: key.to_string(),
        client_id: None,
        client_secret: None,
    })
}

/// 读取 Device Registration（OIDC 专用）
fn read_device_registration(conn: &Connection) -> SqliteResult<DeviceRegistration> {
    // 按优先级尝试读取
    let keys = vec![
        "kirocli:odic:device-registration",
        "codewhisperer:odic:device-registration",
    ];

    for key in keys {
        if let Ok(device_reg) = read_device_registration_by_key(conn, key) {
            return Ok(device_reg);
        }
    }

    Err(rusqlite::Error::QueryReturnedNoRows)
}

/// 从数据库读取指定键的 Device Registration
fn read_device_registration_by_key(
    conn: &Connection,
    key: &str,
) -> SqliteResult<DeviceRegistration> {
    let mut stmt = conn.prepare("SELECT value FROM auth_kv WHERE key = ?1")?;
    let value: String = stmt.query_row([key], |row| row.get(0))?;

    // 解析 JSON
    let data: serde_json::Value =
        serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)?;

    let client_id = data["client_id"]
        .as_str()
        .ok_or(rusqlite::Error::InvalidQuery)?
        .to_string();

    let client_secret = data["client_secret"]
        .as_str()
        .ok_or(rusqlite::Error::InvalidQuery)?
        .to_string();

    let region = data["region"].as_str().unwrap_or("us-east-1").to_string();

    Ok(DeviceRegistration {
        client_id,
        client_secret,
        region,
    })
}
