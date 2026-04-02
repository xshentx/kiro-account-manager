// MCP 服务器管理命令

#![allow(clippy::needless_pass_by_value)] // Tauri 命令需要按值传递参数

use crate::commands::common::run_blocking_task;
use crate::mcp::{McpConfig, McpServer};

/// 获取 MCP 配置（支持项目级合并）
#[tauri::command]
pub async fn get_mcp_config(project_dir: Option<String>) -> Result<McpConfig, String> {
    run_blocking_task(move || McpConfig::load_merged(project_dir.as_deref())).await
}

/// 保存/更新服务器配置
#[tauri::command]
pub async fn save_mcp_server(
    name: String,
    config: McpServer,
    project_dir: Option<String>,
) -> Result<(), String> {
    run_blocking_task(move || {
        // 验证配置
        validate_mcp_server(&config)?;

        if let Some(pd) = project_dir {
            let path = McpConfig::project_config_path(&pd);
            let mut mcp_config = McpConfig::load_from_path(&path)?;
            mcp_config.mcp_servers.insert(name, config);
            mcp_config.save_to_path(&path)
        } else {
            let mut mcp_config = McpConfig::load()?;
            mcp_config.mcp_servers.insert(name, config);
            mcp_config.save()
        }
    })
    .await
}

/// 验证 MCP 服务器配置
fn validate_mcp_server(config: &McpServer) -> Result<(), String> {
    match config {
        McpServer::Command(cmd) => {
            // 验证 command 字段
            if cmd.command.trim().is_empty() {
                return Err("command 字段不能为空".to_string());
            }

            // 验证 autoApprove 字段（可选）
            for tool in &cmd.auto_approve {
                if tool.trim().is_empty() {
                    return Err("autoApprove 中不能包含空字符串".to_string());
                }
            }

            Ok(())
        }
        McpServer::Url(url_config) => {
            // 验证 URL 格式
            if url_config.url.trim().is_empty() {
                return Err("url 字段不能为空".to_string());
            }

            // 简单的 URL 格式验证
            if !url_config.url.starts_with("http://") && !url_config.url.starts_with("https://") {
                return Err("url 必须以 http:// 或 https:// 开头".to_string());
            }

            Ok(())
        }
    }
}

/// 删除服务器
#[tauri::command]
pub async fn delete_mcp_server(name: String, project_dir: Option<String>) -> Result<(), String> {
    run_blocking_task(move || {
        if let Some(pd) = project_dir {
            let path = McpConfig::project_config_path(&pd);
            let mut mcp_config = McpConfig::load_from_path(&path)?;
            mcp_config.mcp_servers.remove(&name);
            mcp_config.save_to_path(&path)
        } else {
            let mut mcp_config = McpConfig::load()?;
            mcp_config.mcp_servers.remove(&name);
            mcp_config.save()
        }
    })
    .await
}

/// 启用/禁用服务器
#[tauri::command]
pub async fn toggle_mcp_server(
    name: String,
    disabled: bool,
    project_dir: Option<String>,
) -> Result<(), String> {
    run_blocking_task(move || {
        if let Some(pd) = project_dir {
            let path = McpConfig::project_config_path(&pd);
            let mut mcp_config = McpConfig::load_from_path(&path)?;
            if let Some(server) = mcp_config.mcp_servers.get_mut(&name) {
                match server {
                    McpServer::Command(cmd) => cmd.disabled = disabled,
                    McpServer::Url(url) => url.disabled = disabled,
                }
                mcp_config.save_to_path(&path)
            } else {
                Err(format!("服务器 {name} 不存在"))
            }
        } else {
            let mut mcp_config = McpConfig::load()?;
            if let Some(server) = mcp_config.mcp_servers.get_mut(&name) {
                match server {
                    McpServer::Command(cmd) => cmd.disabled = disabled,
                    McpServer::Url(url) => url.disabled = disabled,
                }
                mcp_config.save()
            } else {
                Err(format!("服务器 {name} 不存在"))
            }
        }
    })
    .await
}

/// 获取 MCP 工具统计信息（支持项目级合并）
#[tauri::command]
pub async fn get_mcp_tool_stats(project_dir: Option<String>) -> Result<serde_json::Value, String> {
    run_blocking_task(move || {
        let mcp_config = McpConfig::load_merged(project_dir.as_deref())?;

        let total_servers = mcp_config.mcp_servers.len();
        let enabled_servers = mcp_config
            .mcp_servers
            .values()
            .filter(|server| match server {
                McpServer::Command(cmd) => !cmd.disabled,
                McpServer::Url(url) => !url.disabled,
            })
            .count();

        // 估算工具数量：每个启用的服务器平均 5-10 个工具
        // 使用保守估计：每个服务器 7 个工具
        let estimated_tools = enabled_servers * 7;

        Ok(serde_json::json!({
            "totalServers": total_servers,
            "enabledServers": enabled_servers,
            "estimatedTools": estimated_tools,
        }))
    })
    .await
}
