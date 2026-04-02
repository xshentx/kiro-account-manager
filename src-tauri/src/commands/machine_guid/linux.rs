// Linux 平台机器码实现

use chrono::Local;
use std::io::Write;
use std::process::{Command, Stdio};
use uuid::Uuid;

use super::types::{MachineGuidBackup, SystemMachineInfo};
use super::utils::*;

const MACHINE_ID_PATHS: [&str; 2] = ["/etc/machine-id", "/var/lib/dbus/machine-id"];

fn read_machine_id() -> Result<String, String> {
    for path in &MACHINE_ID_PATHS {
        if let Ok(content) = std::fs::read_to_string(path) {
            return Ok(content.trim().to_string());
        }
    }
    Err("无法获取 Linux 机器码".to_string())
}

fn write_with_pkexec(raw_id: &str) -> Result<(), String> {
    let mut child = Command::new("pkexec")
        .args(["tee", "/etc/machine-id"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("执行 pkexec 失败: {}", e))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(format!("{}\n", raw_id).as_bytes()).ok();
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待 pkexec 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("dismissed") || stderr.contains("Not authorized") {
            return Err("用户取消了授权".to_string());
        }
        return Err(format!("写入失败: {}", stderr));
    }
    Ok(())
}

pub fn get_system_machine_guid_inner() -> Result<SystemMachineInfo, String> {
    let (backup_exists, backup_time) = read_backup_info();
    Ok(SystemMachineInfo {
        machine_guid: Some(format_as_uuid(&read_machine_id()?)),
        backup_exists,
        backup_time,
        os_type: "linux".to_string(),
        can_modify: true,
        requires_admin: true,
    })
}

pub fn backup_machine_guid_inner() -> Result<MachineGuidBackup, String> {
    let backup = MachineGuidBackup {
        machine_guid: format_as_uuid(&read_machine_id()?),
        backup_time: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        computer_name: std::env::var("HOSTNAME")
            .ok()
            .or_else(|| std::env::var("USER").ok()),
        os_type: Some("linux".to_string()),
    };
    save_backup(&backup)?;
    Ok(backup)
}

pub fn restore_machine_guid_inner() -> Result<String, String> {
    let backup = load_backup()?;
    write_with_pkexec(&backup.machine_guid.replace("-", "").to_lowercase())?;
    Ok(backup.machine_guid)
}

pub fn reset_machine_guid_inner() -> Result<String, String> {
    let new_guid = Uuid::new_v4().to_string().to_lowercase();
    write_with_pkexec(&new_guid.replace("-", ""))?;
    Ok(new_guid)
}

pub fn set_custom_machine_guid_inner(new_guid: String) -> Result<String, String> {
    if !is_valid_machine_id(&new_guid) {
        return Err("无效的机器码格式".to_string());
    }
    let raw_id = new_guid.replace("-", "").to_lowercase();
    write_with_pkexec(&raw_id)?;
    Ok(format_as_uuid(&raw_id))
}

pub fn clear_override_inner() -> Result<(), String> {
    Ok(())
}
