// 进程管理相关功能

use crate::cmd_output::decode_cmd_output;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 检查 Kiro IDE 是否正在运行（内部函数，同步）
#[cfg(target_os = "windows")]
pub fn check_kiro_running() -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq Kiro.exe", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match output {
        Ok(out) => decode_cmd_output(&out.stdout).contains("Kiro.exe"),
        Err(_) => false,
    }
}

#[cfg(target_os = "macos")]
pub fn check_kiro_running() -> bool {
    // 尝试多种方式检测 Kiro 进程
    // 1. 精确匹配 "Kiro"
    let output = Command::new("pgrep").args(["-x", "Kiro"]).output();

    if let Ok(out) = output {
        if out.status.success() {
            return true;
        }
    }

    // 2. 模糊匹配包含 "Kiro" 的进程
    let output = Command::new("pgrep").args(["-f", "Kiro.app"]).output();

    match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn check_kiro_running() -> bool {
    // Linux: 使用 pgrep 检测 kiro 进程
    let output = Command::new("pgrep").args(["-f", "kiro"]).output();

    match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

/// 关闭 Kiro IDE（内部函数）
#[cfg(target_os = "windows")]
pub fn kill_kiro() -> Result<(), String> {
    let output = Command::new("taskkill")
        .args(["/IM", "Kiro.exe", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to execute taskkill: {e}"))?;

    if !output.status.success() {
        let stderr = decode_cmd_output(&output.stderr);
        if !stderr.contains("not found") && !stderr.contains("没有找到") {
            return Err(format!("Failed to close Kiro IDE: {stderr}"));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn kill_kiro() -> Result<(), String> {
    let output = Command::new("pkill")
        .args(["-x", "Kiro"])
        .output()
        .map_err(|e| format!("Failed to execute pkill: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("No matching") {
            return Err(format!("Failed to close Kiro IDE: {stderr}"));
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn kill_kiro() -> Result<(), String> {
    // Linux: 使用 pkill 关闭 kiro 进程
    let output = Command::new("pkill")
        .args(["-f", "kiro"])
        .output()
        .map_err(|e| format!("Failed to execute pkill: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.is_empty() {
            return Err(format!("Failed to close Kiro IDE: {stderr}"));
        }
    }
    Ok(())
}

/// 启动 Kiro IDE（内部函数）
#[cfg(target_os = "windows")]
pub fn launch_kiro() -> Result<(), String> {
    let localappdata = std::env::var("LOCALAPPDATA").map_err(|_| "Cannot find LOCALAPPDATA")?;

    let kiro_path = std::path::Path::new(&localappdata)
        .join("Programs")
        .join("Kiro")
        .join("Kiro.exe");

    if !kiro_path.exists() {
        return Err(format!("Kiro IDE not found at: {}", kiro_path.display()));
    }

    Command::new(&kiro_path)
        .spawn()
        .map_err(|e| format!("Failed to start Kiro IDE: {e}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
pub fn launch_kiro() -> Result<(), String> {
    let kiro_path = "/Applications/Kiro.app";

    if !std::path::Path::new(kiro_path).exists() {
        return Err(format!("Kiro IDE not found at: {}", kiro_path));
    }

    Command::new("open")
        .args(["-a", "Kiro"])
        .spawn()
        .map_err(|e| format!("Failed to start Kiro IDE: {e}"))?;

    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn launch_kiro() -> Result<(), String> {
    // Linux: 尝试从 PATH 或常见位置启动 kiro
    // 先尝试直接执行 kiro 命令
    if Command::new("kiro").spawn().is_ok() {
        return Ok(());
    }

    // 尝试 /usr/bin/kiro
    let kiro_path = "/usr/bin/kiro";
    if std::path::Path::new(kiro_path).exists() {
        Command::new(kiro_path)
            .spawn()
            .map_err(|e| format!("Failed to start Kiro IDE: {e}"))?;
        return Ok(());
    }

    // 尝试 ~/.local/bin/kiro
    if let Ok(home) = std::env::var("HOME") {
        let local_path = format!("{}/.local/bin/kiro", home);
        if std::path::Path::new(&local_path).exists() {
            Command::new(&local_path)
                .spawn()
                .map_err(|e| format!("Failed to start Kiro IDE: {e}"))?;
            return Ok(());
        }
    }

    Err("Kiro IDE not found. Please ensure it's installed and in PATH.".to_string())
}

// ===== Tauri Commands (异步，避免阻塞主线程) =====

/// 检查 Kiro IDE 是否正在运行
#[tauri::command]
pub async fn is_kiro_ide_running() -> bool {
    tokio::task::spawn_blocking(check_kiro_running)
        .await
        .unwrap_or(false)
}

/// 关闭 Kiro IDE 进程
#[tauri::command]
pub async fn close_kiro_ide() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        let was_running = check_kiro_running();
        kill_kiro()?;
        Ok(was_running)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

/// 启动 Kiro IDE
#[tauri::command]
pub async fn start_kiro_ide() -> Result<(), String> {
    tokio::task::spawn_blocking(launch_kiro)
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}
