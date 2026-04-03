mod converter;
mod models;
mod proxy;
mod stream;
mod thinking_parser;

use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
    response::{Json, Response},
    routing::{get, post},
    Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Manager};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex as AsyncMutex},
    task::JoinHandle,
};

use crate::http_client::{build_http_client_with_timeout, is_supported_kiro_region};

#[cfg(test)]
thread_local! {
    static REQUEST_LOG_PATH_OVERRIDE: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn request_log_path_override() -> Option<PathBuf> {
    REQUEST_LOG_PATH_OVERRIDE.with(|cell| cell.borrow().clone())
}

#[cfg(test)]
fn set_request_log_path_override(path: Option<PathBuf>) {
    REQUEST_LOG_PATH_OVERRIDE.with(|cell| *cell.borrow_mut() = path);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default = "default_region")]
    pub region: String,
    #[serde(default = "default_account_mode")]
    pub account_mode: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default = "default_strategy")]
    pub strategy: String,
    #[serde(default = "default_threshold")]
    pub threshold: i32,
    #[serde(default = "default_local_only")]
    pub local_only: bool,
    #[serde(default)]
    pub allowed_ips: Vec<String>,
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub request_count: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRequestLogEntry {
    pub occurred_at: String,
    pub request_index: u64,
    pub endpoint: String,
    pub client_ip: String,
    pub model: Option<String>,
    pub stream: bool,
    pub upstream_source: Option<String>,
    pub region: Option<String>,
    pub status_code: u16,
    pub outcome: String,
    pub duration_ms: u64,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_body: Option<String>,
}

#[derive(Debug)]
pub struct GatewayRuntime {
    pub config: GatewayConfig,
    pub request_count: Arc<AtomicU64>,
    pub last_error: Arc<AsyncMutex<Option<String>>>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_task: Option<JoinHandle<()>>,
}

#[derive(Clone)]
struct RouterState {
    config: GatewayConfig,
    request_count: Arc<AtomicU64>,
    last_error: Arc<AsyncMutex<Option<String>>>,
    http: Client,
}

#[derive(Debug, Clone, Copy)]
enum ResponseFormat {
    Anthropic,
    Responses,
}

const CONFIG_DIR: &str = ".kiro-account-manager";
const CONFIG_FILE: &str = "gateway-config.json";
const LOGS_DIR: &str = "logs";
const REQUEST_LOG_FILE: &str = "gateway-request-log.jsonl";
const DEFAULT_AGENT_MODE: &str = "q-developer-converse";

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_port() -> u16 {
    8765
}

fn default_region() -> String {
    "us-east-1".to_string()
}

fn default_account_mode() -> String {
    "single".to_string()
}

fn default_strategy() -> String {
    "round_robin".to_string()
}

fn default_threshold() -> i32 {
    90
}

fn default_local_only() -> bool {
    true
}

fn default_log_level() -> String {
    "debug".to_string()
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: default_host(),
            port: default_port(),
            access_token: None,
            region: default_region(),
            account_mode: default_account_mode(),
            account_id: None,
            group_id: None,
            strategy: default_strategy(),
            threshold: default_threshold(),
            local_only: default_local_only(),
            allowed_ips: Vec::new(),
            log_level: default_log_level(),
        }
    }
}

impl GatewayStatus {
    pub fn stopped(config: &GatewayConfig) -> Self {
        Self {
            running: false,
            host: config.host.clone(),
            port: config.port,
            request_count: 0,
            last_error: None,
        }
    }
}

fn ensure_config_valid(config: &GatewayConfig) -> Result<(), String> {
    if config.host.trim().is_empty() {
        return Err("监听地址不能为空".to_string());
    }
    if config.port == 0 {
        return Err("端口必须大于 0".to_string());
    }

    let region = config.region.trim();
    if region.is_empty() {
        return Err("region 不能为空".to_string());
    }
    if !is_supported_kiro_region(region) {
        return Err(format!("region 不受支持: {region}"));
    }
    match config.account_mode.as_str() {
        "single"
            if config
                .account_id
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty() =>
        {
            return Err("single 模式必须选择账号".to_string());
        }
        "group"
            if config
                .group_id
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty() =>
        {
            return Err("group 模式必须选择分组".to_string());
        }
        "single" | "group" => {}
        "local" => {
            return Err("网关不再支持 local 模式，请改用 single/group 账号池模式".to_string());
        }
        _ => return Err("accountMode 必须是 single/group".to_string()),
    }
    if !matches!(
        config.log_level.as_str(),
        "debug" | "info" | "warn" | "error"
    ) {
        return Err("logLevel 必须是 debug/info/warn/error".to_string());
    }
    if config
        .access_token
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return Err("必须配置客户端 API Key".to_string());
    }
    for entry in &config.allowed_ips {
        if !is_valid_allowlist_entry(entry) {
            return Err(format!("白名单条目无效: {entry}"));
        }
    }
    Ok(())
}

fn is_valid_allowlist_entry(entry: &str) -> bool {
    let trimmed = entry.trim();
    !trimmed.is_empty()
        && (trimmed.parse::<IpAddr>().is_ok() || trimmed.parse::<ipnet::IpNet>().is_ok())
}

fn normalize_config(config: &GatewayConfig) -> GatewayConfig {
    let mut normalized = config.clone();
    normalized.host = normalized.host.trim().to_string();
    normalized.region = normalized.region.trim().to_string();
    normalized.account_mode = normalized.account_mode.trim().to_string();
    normalized.strategy = normalized.strategy.trim().to_string();
    normalized.log_level = normalized.log_level.trim().to_ascii_lowercase();
    normalized.allowed_ips = normalized
        .allowed_ips
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .fold(Vec::new(), |mut acc, item| {
            if !acc.contains(&item) {
                acc.push(item);
            }
            acc
        });
    normalized
}

fn config_path() -> Result<PathBuf, String> {
    Ok(ensure_gateway_data_dir()?.join(CONFIG_FILE))
}

fn request_log_path() -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(path) = request_log_path_override() {
        return Ok(path);
    }
    Ok(gateway_log_dir_raw()?.join(REQUEST_LOG_FILE))
}

fn append_gateway_request_log_to_path(
    path: &Path,
    entry: &GatewayRequestLogEntry,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建请求日志目录失败: {e}"))?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("打开请求日志失败: {e}"))?;
    let serialized =
        serde_json::to_string(entry).map_err(|e| format!("序列化请求日志失败: {e}"))?;
    writeln!(file, "{serialized}").map_err(|e| format!("写入请求日志失败: {e}"))
}

fn get_gateway_request_logs_from_path(
    path: &Path,
    limit: Option<usize>,
) -> Result<Vec<GatewayRequestLogEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let file = fs::File::open(path).map_err(|e| format!("读取请求日志失败: {e}"))?;
    let reader = BufReader::new(file);
    let max_items = limit.unwrap_or(100).clamp(1, 500);
    let mut entries = Vec::new();

    for line in reader.lines() {
        let Ok(line) = line else {
            continue;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<GatewayRequestLogEntry>(trimmed) {
            entries.push(entry);
        }
    }

    let start = entries.len().saturating_sub(max_items);
    let mut recent = entries.split_off(start);
    recent.reverse();
    Ok(recent)
}

fn clear_gateway_request_logs_at_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(path).map_err(|e| format!("清空请求日志失败: {e}"))
}

fn gateway_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| {
            let home = std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home)
        })
        .join(CONFIG_DIR)
}

fn ensure_gateway_data_dir() -> Result<PathBuf, String> {
    let dir = gateway_data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    Ok(dir)
}

fn gateway_log_dir_raw() -> Result<PathBuf, String> {
    let dir = ensure_gateway_data_dir()?.join(LOGS_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("创建日志目录失败: {e}"))?;
    Ok(dir)
}

pub fn load_gateway_config() -> Result<GatewayConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(GatewayConfig::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("读取配置失败: {e}"))?;
    let cfg = serde_json::from_str::<GatewayConfig>(&content)
        .map_err(|e| format!("解析配置失败: {e}"))?;
    Ok(normalize_config(&cfg))
}

pub fn get_gateway_config() -> Result<GatewayConfig, String> {
    load_gateway_config()
}

pub fn save_gateway_config(config: &GatewayConfig) -> Result<(), String> {
    let normalized = normalize_config(config);
    ensure_config_valid(&normalized)?;
    let path = config_path()?;
    let content =
        serde_json::to_string_pretty(&normalized).map_err(|e| format!("序列化配置失败: {e}"))?;
    fs::write(path, content).map_err(|e| format!("写入配置失败: {e}"))
}

pub fn append_gateway_request_log(entry: &GatewayRequestLogEntry) -> Result<(), String> {
    let path = request_log_path()?;
    append_gateway_request_log_to_path(&path, entry)
}

pub fn get_gateway_request_logs(
    limit: Option<usize>,
) -> Result<Vec<GatewayRequestLogEntry>, String> {
    let path = request_log_path()?;
    get_gateway_request_logs_from_path(&path, limit)
}

pub fn clear_gateway_request_logs() -> Result<(), String> {
    let path = request_log_path()?;
    clear_gateway_request_logs_at_path(&path)
}

pub async fn start_gateway(
    state: &tauri::State<'_, crate::state::AppState>,
    config: GatewayConfig,
) -> Result<GatewayStatus, String> {
    let config = normalize_config(&config);
    ensure_config_valid(&config)?;

    let existing = {
        let mut guard = state
            .gateway
            .lock()
            .map_err(|_| "获取 gateway 状态失败".to_string())?;
        guard.take()
    };

    if let Some(mut rt) = existing {
        stop_runtime(&mut rt).await;
    }

    let runtime = spawn_runtime(config.clone()).await?;
    let status = GatewayStatus {
        running: true,
        host: config.host.clone(),
        port: config.port,
        request_count: 0,
        last_error: None,
    };

    let mut guard = state
        .gateway
        .lock()
        .map_err(|_| "获取 gateway 状态失败".to_string())?;
    *guard = Some(runtime);

    Ok(status)
}

pub async fn stop_gateway(state: &tauri::State<'_, crate::state::AppState>) -> Result<(), String> {
    let existing = {
        let mut guard = state
            .gateway
            .lock()
            .map_err(|_| "获取 gateway 状态失败".to_string())?;
        guard.take()
    };

    if let Some(mut rt) = existing {
        stop_runtime(&mut rt).await;
    }

    Ok(())
}

pub async fn get_gateway_status(
    state: &tauri::State<'_, crate::state::AppState>,
) -> Result<GatewayStatus, String> {
    let snapshot = {
        let guard = state
            .gateway
            .lock()
            .map_err(|_| "获取 gateway 状态失败".to_string())?;

        guard.as_ref().map(|rt| {
            (
                rt.config.clone(),
                rt.request_count.load(Ordering::Relaxed),
                rt.last_error.clone(),
                rt.server_task.is_some(),
            )
        })
    };

    if let Some((config, request_count, last_error, running)) = snapshot {
        let last_error_text = last_error.lock().await.clone();
        Ok(GatewayStatus {
            running,
            host: config.host,
            port: config.port,
            request_count,
            last_error: last_error_text,
        })
    } else {
        let cfg = load_gateway_config().unwrap_or_default();
        Ok(GatewayStatus::stopped(&cfg))
    }
}

fn router(state: RouterState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/v1/models", get(models_handler))
        .route("/messages", post(messages_handler))
        .route("/v1/messages", post(messages_handler))
        .route("/v1/messages/count_tokens", post(count_tokens_handler))
        .route("/v1/responses", post(responses_handler))
        .route("/mcp", post(mcp_handler))
        .with_state(state)
}

async fn spawn_runtime(config: GatewayConfig) -> Result<GatewayRuntime, String> {
    ensure_config_valid(&config)?;

    let request_count = Arc::new(AtomicU64::new(0));
    let last_error = Arc::new(AsyncMutex::new(None));

    let http = build_http_client_with_timeout(120, 10)
        .map_err(|e| format!("初始化 HTTP 客户端失败: {e}"))?;

    let state = RouterState {
        config: config.clone(),
        request_count: request_count.clone(),
        last_error: last_error.clone(),
        http,
    };

    let app = router(state);
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e| format!("监听地址无效: {e}"))?;

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("绑定端口失败: {e}"))?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = shutdown_rx.await;
    });

    let server_task = tokio::spawn(async move {
        if let Err(e) = server.await {
            eprintln!("gateway server error: {e}");
        }
    });

    Ok(GatewayRuntime {
        config,
        request_count,
        last_error,
        shutdown_tx: Some(shutdown_tx),
        server_task: Some(server_task),
    })
}

async fn stop_runtime(runtime: &mut GatewayRuntime) {
    if let Some(tx) = runtime.shutdown_tx.take() {
        let _ = tx.send(());
    }
    if let Some(task) = runtime.server_task.take() {
        let _ = task.await;
    }
}

pub async fn auto_start_if_enabled(app: &AppHandle) -> Result<(), String> {
    let cfg = load_gateway_config()?;
    if !cfg.enabled {
        return Ok(());
    }

    let state = app.state::<crate::state::AppState>();
    let _ = start_gateway(&state, cfg).await?;
    Ok(())
}

pub fn gateway_log_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    gateway_log_dir_raw()
}

pub fn get_gateway_log_dir(app: &AppHandle) -> Result<String, String> {
    gateway_log_dir(app).map(|path| path.to_string_lossy().to_string())
}

pub fn open_gateway_log_dir(app: &AppHandle) -> Result<String, String> {
    let dir = gateway_log_dir(app)?;
    open::that(&dir).map_err(|e| format!("打开日志目录失败: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

async fn health_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<RouterState>,
    headers: HeaderMap,
) -> Response {
    proxy::health_handler(state, addr, headers).await
}

async fn models_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<RouterState>,
    headers: HeaderMap,
) -> Response {
    proxy::models_handler(state, addr, headers).await
}

async fn count_tokens_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<RouterState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    proxy::count_tokens_handler(state, addr, headers, payload).await
}

async fn messages_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<RouterState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    proxy::proxy_handler(state, addr, headers, payload, ResponseFormat::Anthropic).await
}

async fn responses_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<RouterState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    proxy::proxy_handler(state, addr, headers, payload, ResponseFormat::Responses).await
}

async fn mcp_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<RouterState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    proxy::mcp_proxy_handler(state, addr, headers, payload).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{header::AUTHORIZATION, HeaderMap, HeaderValue, Method, Request, StatusCode};
    use serde_json::json;
    use std::{
        process,
        sync::{
            atomic::{AtomicU64, Ordering},
            Mutex,
        },
    };
    use tower::util::ServiceExt;

    static REQUEST_LOG_TEST_MUTEX: Mutex<()> = Mutex::new(());
    static REQUEST_LOG_TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct RequestLogTestFixture {
        path: PathBuf,
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    impl RequestLogTestFixture {
        fn new() -> Self {
            let guard = REQUEST_LOG_TEST_MUTEX
                .lock()
                .expect("request log test mutex should lock");
            let dir = std::env::temp_dir().join(format!(
                "kiro-gateway-request-log-test-{}-{}",
                process::id(),
                REQUEST_LOG_TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).expect("request log test dir should create");
            let path = dir.join(REQUEST_LOG_FILE);
            set_request_log_path_override(Some(path.clone()));
            Self {
                path,
                _guard: guard,
            }
        }
    }

    impl Drop for RequestLogTestFixture {
        fn drop(&mut self) {
            set_request_log_path_override(None);
            if let Some(dir) = self.path.parent() {
                let _ = fs::remove_dir_all(dir);
            }
        }
    }

    fn gateway_runtime_test_state() -> RouterState {
        RouterState {
            config: GatewayConfig {
                access_token: Some("sk-test".to_string()),
                account_mode: "single".to_string(),
                account_id: Some("test-account".to_string()),
                ..GatewayConfig::default()
            },
            request_count: Arc::new(AtomicU64::new(0)),
            last_error: Arc::new(AsyncMutex::new(None)),
            http: Client::new(),
        }
    }

    fn auth_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer sk-test"));
        headers
    }

    #[test]
    fn config_path_uses_roaming_appdata_root() {
        let expected = dirs::data_dir()
            .expect("data_dir should exist in test environment")
            .join(CONFIG_DIR)
            .join(CONFIG_FILE);

        let actual = config_path().expect("config path should resolve");

        assert_eq!(actual, expected);
    }

    #[test]
    fn gateway_data_dir_puts_logs_under_same_root() {
        let expected = dirs::data_dir()
            .expect("data_dir should exist in test environment")
            .join(CONFIG_DIR)
            .join(LOGS_DIR);

        let actual = ensure_gateway_data_dir()
            .expect("gateway data dir should resolve")
            .join(LOGS_DIR);

        assert_eq!(actual, expected);
    }

    #[test]
    fn gateway_request_logs_round_trip_recent_entries() {
        let fixture = RequestLogTestFixture::new();
        let path = fixture.path.as_path();

        let success_entry = GatewayRequestLogEntry {
            occurred_at: "2026-03-21 18:00:00".to_string(),
            request_index: 1,
            endpoint: "responses".to_string(),
            client_ip: "127.0.0.1".to_string(),
            model: Some("claude-sonnet-4.5".to_string()),
            stream: false,
            upstream_source: Some("本地 Kiro 登录态".to_string()),
            region: Some("us-east-1".to_string()),
            status_code: 200,
            outcome: "success".to_string(),
            duration_ms: 120,
            error: None,
            request_body: Some(r#"{"model":"claude-sonnet-4-5"}"#.to_string()),
            response_body: Some(r#"{"id":"resp_123"}"#.to_string()),
        };
        let error_entry = GatewayRequestLogEntry {
            occurred_at: "2026-03-21 18:00:01".to_string(),
            request_index: 2,
            endpoint: "mcp".to_string(),
            client_ip: "127.0.0.1".to_string(),
            model: None,
            stream: false,
            upstream_source: Some("测试账号".to_string()),
            region: Some("us-east-1".to_string()),
            status_code: 502,
            outcome: "error".to_string(),
            duration_ms: 450,
            error: Some("上游请求失败".to_string()),
            request_body: Some(r#"{"method":"tools/list"}"#.to_string()),
            response_body: Some(r#"{"message":"upstream failed"}"#.to_string()),
        };

        append_gateway_request_log_to_path(path, &success_entry)
            .expect("success entry should append");
        append_gateway_request_log_to_path(path, &error_entry).expect("error entry should append");

        let logs =
            get_gateway_request_logs_from_path(path, Some(10)).expect("request logs should read");
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].request_index, 2);
        assert_eq!(logs[1].request_index, 1);
        assert_eq!(
            logs[0].request_body.as_deref(),
            Some(r#"{"method":"tools/list"}"#)
        );
        assert_eq!(
            logs[1].response_body.as_deref(),
            Some(r#"{"id":"resp_123"}"#)
        );
    }

    #[test]
    fn clear_gateway_request_logs_removes_log_file() {
        let fixture = RequestLogTestFixture::new();
        let path = fixture.path.as_path();

        append_gateway_request_log_to_path(
            path,
            &GatewayRequestLogEntry {
                occurred_at: "2026-03-21 18:00:02".to_string(),
                request_index: 3,
                endpoint: "responses".to_string(),
                client_ip: "127.0.0.1".to_string(),
                model: Some("claude-sonnet-4.6".to_string()),
                stream: false,
                upstream_source: Some("测试账号".to_string()),
                region: Some("us-east-1".to_string()),
                status_code: 200,
                outcome: "success".to_string(),
                duration_ms: 110,
                error: None,
                request_body: Some(r#"{"model":"claude-sonnet-4-6"}"#.to_string()),
                response_body: Some(r#"{"id":"resp_456"}"#.to_string()),
            },
        )
        .expect("request log entry should append");

        clear_gateway_request_logs_at_path(path).expect("request log file should clear");
        assert!(!path.exists(), "request log file should be removed");
    }

    fn test_router_state() -> RouterState {
        RouterState {
            config: GatewayConfig::default(),
            request_count: Arc::new(AtomicU64::new(0)),
            last_error: Arc::new(AsyncMutex::new(None)),
            http: Client::new(),
        }
    }

    fn runtime_test_gateway_config(port: u16) -> GatewayConfig {
        GatewayConfig {
            port,
            local_only: false,
            account_mode: "single".to_string(),
            account_id: Some("test-account".to_string()),
            access_token: Some("sk-test".to_string()),
            ..GatewayConfig::default()
        }
    }

    #[tokio::test]
    async fn health_route_is_reachable() {
        let app = router(test_router_state());
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/health")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_ne!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn responses_route_is_reachable() {
        let app = router(test_router_state());
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/responses")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "model": "claude-sonnet-4-5-20250929",
                            "input": [{ "role": "user", "content": "hello" }]
                        })
                        .to_string(),
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_ne!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn chat_completions_route_returns_not_found() {
        let app = router(test_router_state());
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/chat/completions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "model": "claude-sonnet-4-5-20250929",
                            "messages": [{ "role": "user", "content": "hello" }]
                        })
                        .to_string(),
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn mcp_route_is_reachable() {
        let app = router(test_router_state());
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/mcp")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "tools/list",
                            "params": {}
                        })
                        .to_string(),
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_ne!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn lightweight_routes_increment_request_count_and_write_logs() {
        let fixture = RequestLogTestFixture::new();
        let state = gateway_runtime_test_state();
        let client_addr: SocketAddr = "127.0.0.1:4317".parse().expect("socket addr should parse");

        let health = proxy::health_handler(state.clone(), client_addr, auth_headers()).await;
        assert_eq!(health.status(), StatusCode::OK);

        let models = proxy::models_handler(state.clone(), client_addr, auth_headers()).await;
        assert_eq!(models.status(), StatusCode::OK);

        let count_tokens = proxy::count_tokens_handler(
            state.clone(),
            client_addr,
            auth_headers(),
            json!({
                "model": "claude-sonnet-4-5-20250929",
                "messages": [{ "role": "user", "content": "hello world" }]
            }),
        )
        .await;
        assert_eq!(count_tokens.status(), StatusCode::OK);

        assert_eq!(state.request_count.load(Ordering::Relaxed), 3);

        let logs = get_gateway_request_logs_from_path(fixture.path.as_path(), Some(10))
            .expect("request logs should read");
        assert_eq!(logs.len(), 3);
        assert_eq!(logs[0].endpoint, "count_tokens");
        assert_eq!(logs[1].endpoint, "models");
        assert_eq!(logs[2].endpoint, "health");
        assert_eq!(logs[0].status_code, 200);
        assert_eq!(logs[1].status_code, 200);
        assert_eq!(logs[2].status_code, 200);
        assert_eq!(logs[0].outcome, "success");
        assert_eq!(logs[1].outcome, "success");
        assert_eq!(logs[2].outcome, "success");
        assert_eq!(logs[0].client_ip, "127.0.0.1");
        assert!(
            logs[0]
                .request_body
                .as_deref()
                .is_some_and(|body| body.contains("\"hello world\"")),
            "count_tokens request body should be logged"
        );
        let count_tokens_response = logs[0]
            .response_body
            .as_deref()
            .and_then(|body| serde_json::from_str::<Value>(body).ok())
            .expect("count_tokens response body should be logged as json");
        assert_eq!(
            count_tokens_response
                .get("input_tokens")
                .and_then(Value::as_u64),
            Some(2)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn mcp_route_increments_request_count_and_writes_error_log() {
        let fixture = RequestLogTestFixture::new();
        let state = gateway_runtime_test_state();
        let client_addr: SocketAddr = "127.0.0.1:4318".parse().expect("socket addr should parse");

        let response = proxy::mcp_proxy_handler(
            state.clone(),
            client_addr,
            auth_headers(),
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {}
            }),
        )
        .await;

        assert_eq!(state.request_count.load(Ordering::Relaxed), 1);
        assert!(response.status().is_client_error() || response.status().is_server_error());

        let logs = get_gateway_request_logs_from_path(fixture.path.as_path(), Some(10))
            .expect("request logs should read");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].endpoint, "mcp");
        assert_eq!(logs[0].client_ip, "127.0.0.1");
        assert_eq!(logs[0].request_index, 0);
        assert_eq!(logs[0].outcome, "error");
        assert_eq!(logs[0].status_code, response.status().as_u16());
        assert!(
            logs[0]
                .request_body
                .as_deref()
                .is_some_and(|body| body.contains("\"tools/list\"")),
            "mcp request body should be logged"
        );
        assert!(
            state.last_error.lock().await.is_some(),
            "mcp error should update last_error"
        );
    }

    #[test]
    fn rejects_unsupported_region() {
        let config = GatewayConfig {
            region: "moon-east-1".to_string(),
            ..GatewayConfig::default()
        };

        let err = ensure_config_valid(&config).expect_err("unsupported region should fail");
        assert!(err.contains("region 不受支持"));
    }

    #[test]
    fn rejects_local_account_mode_for_gateway() {
        let config = GatewayConfig {
            account_mode: "local".to_string(),
            access_token: Some("sk-test".to_string()),
            ..GatewayConfig::default()
        };

        let err = ensure_config_valid(&config).expect_err("local mode should fail");
        assert!(
            err.contains("不再支持 local 模式"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn accepts_known_regions() {
        let mut config = GatewayConfig {
            account_id: Some("test-account".to_string()),
            access_token: Some("sk-test".to_string()),
            ..GatewayConfig::default()
        };
        for region in [
            "us-east-1",
            "eu-central-1",
            "us-west-2",
            "ap-northeast-1",
            "ap-southeast-1",
            "us-gov-west-1",
        ] {
            config.region = region.to_string();
            ensure_config_valid(&config).expect("known region should pass validation");
        }
    }

    #[test]
    fn rejects_remote_access_without_api_key() {
        let config = GatewayConfig {
            local_only: false,
            account_id: Some("test-account".to_string()),
            access_token: None,
            ..GatewayConfig::default()
        };

        let err =
            ensure_config_valid(&config).expect_err("remote access without api key should fail");
        assert!(err.contains("API Key"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn runtime_serves_health_over_real_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = runtime_test_gateway_config(port);
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/health"))
            .bearer_auth("sk-test")
            .send()
            .await
            .expect("health request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        stop_runtime(&mut runtime).await;
    }

    #[tokio::test]
    async fn runtime_serves_models_over_real_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = runtime_test_gateway_config(port);
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/v1/models"))
            .bearer_auth("sk-test")
            .send()
            .await
            .expect("models request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let payload: Value = response.json().await.expect("models response should be json");
        assert_eq!(payload.get("object").and_then(Value::as_str), Some("list"));
        assert!(
            payload
                .get("data")
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty()),
            "models response should include at least one model"
        );
        stop_runtime(&mut runtime).await;
    }

    #[tokio::test]
    async fn runtime_serves_count_tokens_over_real_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = runtime_test_gateway_config(port);
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/v1/messages/count_tokens"))
            .bearer_auth("sk-test")
            .header("content-type", "application/json")
            .body(
                json!({
                    "model": "claude-sonnet-4-5-20250929",
                    "messages": [{ "role": "user", "content": "hello world" }]
                })
                .to_string(),
            )
            .send()
            .await
            .expect("count tokens request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        let payload: Value = response
            .json()
            .await
            .expect("count tokens response should be json");
        assert_eq!(payload.get("input_tokens").and_then(Value::as_u64), Some(2));
        stop_runtime(&mut runtime).await;
    }

    #[tokio::test]
    async fn runtime_rejects_unauthenticated_health_requests_over_real_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = runtime_test_gateway_config(port);
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/health"))
            .send()
            .await
            .expect("health request should succeed");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        stop_runtime(&mut runtime).await;
    }

    #[tokio::test]
    async fn runtime_rejects_unauthenticated_models_requests_over_real_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = runtime_test_gateway_config(port);
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/v1/models"))
            .send()
            .await
            .expect("models request should succeed");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        stop_runtime(&mut runtime).await;
    }

    #[tokio::test]
    async fn runtime_rejects_unauthenticated_count_tokens_requests_over_real_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = runtime_test_gateway_config(port);
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/v1/messages/count_tokens"))
            .header("content-type", "application/json")
            .body(
                json!({
                    "model": "claude-sonnet-4-5-20250929",
                    "input": [{ "role": "user", "content": "hello" }]
                })
                .to_string(),
            )
            .send()
            .await
            .expect("count tokens request should succeed");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        stop_runtime(&mut runtime).await;
    }

    #[tokio::test]
    async fn runtime_rejects_unauthenticated_responses_requests_over_real_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = runtime_test_gateway_config(port);
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/v1/responses"))
            .header("content-type", "application/json")
            .body(
                json!({
                    "model": "claude-sonnet-4-5-20250929",
                    "input": [{ "role": "user", "content": "hello" }]
                })
                .to_string(),
            )
            .send()
            .await
            .expect("responses request should succeed");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        stop_runtime(&mut runtime).await;
    }

    #[tokio::test]
    async fn runtime_rejects_unauthenticated_messages_requests_over_real_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = runtime_test_gateway_config(port);
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/messages"))
            .header("content-type", "application/json")
            .body(
                json!({
                    "model": "claude-sonnet-4-5-20250929",
                    "messages": [{ "role": "user", "content": "hello" }]
                })
                .to_string(),
            )
            .send()
            .await
            .expect("messages request should succeed");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        stop_runtime(&mut runtime).await;
    }

    #[tokio::test]
    async fn runtime_rejects_unauthenticated_mcp_requests_over_real_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = runtime_test_gateway_config(port);
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/mcp"))
            .header("content-type", "application/json")
            .body(
                json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/list",
                    "params": {}
                })
                .to_string(),
            )
            .send()
            .await
            .expect("mcp request should succeed");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        stop_runtime(&mut runtime).await;
    }

    #[tokio::test]
    async fn runtime_requires_client_api_key_even_when_local_only() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let port = listener
            .local_addr()
            .expect("local addr should resolve")
            .port();
        drop(listener);

        let config = GatewayConfig {
            port,
            local_only: true,
            account_mode: "single".to_string(),
            account_id: Some("test-account".to_string()),
            access_token: Some("sk-test".to_string()),
            ..GatewayConfig::default()
        };
        let mut runtime = spawn_runtime(config).await.expect("runtime should start");

        let response = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/v1/responses"))
            .header("content-type", "application/json")
            .body(
                json!({
                    "model": "claude-sonnet-4-5-20250929",
                    "input": [{ "role": "user", "content": "hello" }]
                })
                .to_string(),
            )
            .send()
            .await
            .expect("responses request should succeed");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        stop_runtime(&mut runtime).await;
    }
}
