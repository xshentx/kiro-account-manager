// 机器码工具函数

use super::types::MachineGuidBackup;
use regex::Regex;
use std::path::PathBuf;
use std::sync::LazyLock;
use uuid::Uuid;

// 预编译正则表达式
static UUID_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        .expect("Failed to compile UUID regex")
});
static HEX32_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-9a-f]{32}$").expect("Failed to compile HEX32 regex"));

pub fn get_backup_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_default()
        .join(".kiro-account-manager")
        .join("machine-guid-backup.json")
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub fn get_macos_override_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_default()
        .join(".kiro-account-manager")
        .join("machine-id-override")
}

pub fn generate_random_machine_id() -> String {
    Uuid::new_v4().to_string().to_lowercase()
}

pub fn get_machine_id() -> String {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        super::platform::get_system_machine_guid_inner()
            .ok()
            .and_then(|i| i.machine_guid)
            .unwrap_or_else(generate_random_machine_id)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        generate_random_machine_id()
    }
}

pub fn is_valid_machine_id(id: &str) -> bool {
    let lower = id.to_lowercase();
    UUID_REGEX.is_match(&lower) || HEX32_REGEX.is_match(&lower)
}

#[cfg(target_os = "linux")]
pub fn format_as_uuid(hex: &str) -> String {
    let c = hex.replace("-", "").to_lowercase();
    if c.len() != 32 {
        return c;
    }
    format!(
        "{}-{}-{}-{}-{}",
        &c[0..8],
        &c[8..12],
        &c[12..16],
        &c[16..20],
        &c[20..32]
    )
}

pub fn read_backup_info() -> (bool, Option<String>) {
    std::fs::read_to_string(get_backup_path())
        .ok()
        .and_then(|c| serde_json::from_str::<MachineGuidBackup>(&c).ok())
        .map_or((false, None), |b| (true, Some(b.backup_time)))
}

pub fn get_machine_guid_backup_inner() -> Result<Option<MachineGuidBackup>, String> {
    let path = get_backup_path();
    if !path.exists() {
        return Ok(None);
    }
    load_backup().map(Some)
}

pub fn save_backup(backup: &MachineGuidBackup) -> Result<(), String> {
    write_file_with_dir(
        &get_backup_path(),
        &serde_json::to_string_pretty(backup).map_err(|e| format!("序列化失败: {e}"))?,
    )
    .map_err(|e| format!("写入备份失败: {e}"))
}

pub fn write_file_with_dir(path: &std::path::Path, content: &str) -> std::io::Result<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(path, content)
}

pub fn load_backup() -> Result<MachineGuidBackup, String> {
    let path = get_backup_path();
    if !path.exists() {
        return Err("没有找到备份文件".to_string());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取备份失败: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("解析备份失败: {e}"))
}
