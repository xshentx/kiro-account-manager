#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod auth_social;
mod auto_switch;
mod aws_sso_client;
mod browser;
mod commands;
mod deep_link_handler;
mod http_client;

mod gateway;
mod kiro;
mod kiro_auth_client;
mod kiro_cli_db;
mod kiro_portal_client;
mod mcp;

mod account;
mod cmd_output;
mod custom_agents;
mod hooks;
mod powers;
mod process;
mod providers;
mod skills;
mod state;
mod steering;
mod tray_behavior;

use account::{AccountStore, GroupTagStore};
use auth::AuthState;
use state::AppState;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{Listener, Manager};

// 导入命令
use browser::detect_installed_browsers;
use commands::account_cmd::{
    add_account_by_idc, add_account_by_social, add_local_kiro_account, delete_account,
    delete_account_remote, delete_accounts, export_accounts, get_account_usage, get_accounts,
    get_accounts_by_group, get_accounts_by_tag, get_available_accounts, import_accounts,
    list_available_models, refresh_account_token, sync_account, update_account, verify_account,
};
use commands::app_settings_cmd::{
    bind_machine_id_to_account, get_all_bound_machine_ids, get_app_settings, get_bound_machine_id,
    get_usage_history, save_app_settings, save_usage_history_entry, unbind_machine_id_from_account,
};
use commands::auth_cmd::{
    cancel_kiro_login, get_current_user, get_supported_providers, handle_kiro_social_callback,
    kiro_login, logout,
};
use commands::gateway_cmd::{
    clear_gateway_request_logs, get_gateway_config, get_gateway_log_dir, get_gateway_request_logs,
    get_gateway_status, open_gateway_log_dir, save_gateway_config, start_gateway, stop_gateway,
};
use commands::group_tag_cmd::{
    add_group, add_tag, add_tag_to_account, delete_group, delete_tag, get_groups, get_tags,
    remove_account_tags, remove_tag_from_account, reorder_groups, set_account_group,
    set_account_tags, update_group, update_tag,
};
use commands::kiro_cli_cmd::{get_kiro_cli_default_path, import_from_kiro_cli};
use commands::kiro_settings_cmd::{
    get_kiro_settings, set_kiro_agent_autonomy, set_kiro_code_references,
    set_kiro_codebase_indexing, set_kiro_configure_mcp, set_kiro_debug_logs, set_kiro_model,
    set_kiro_notification, set_kiro_proxy, set_kiro_reference_tracker, set_kiro_tab_autocomplete,
    set_kiro_telemetry, set_kiro_trusted_commands, set_kiro_trusted_tools, set_kiro_usage_summary,
};
use commands::machine_guid::{
    backup_machine_guid, clear_macos_override, generate_machine_guid, get_machine_guid_backup,
    get_system_machine_guid, reset_system_machine_guid, restart_as_admin, restore_machine_guid,
    set_custom_machine_guid,
};
use commands::mcp_cmd::{
    delete_mcp_server, get_mcp_config, get_mcp_tool_stats, save_mcp_server, toggle_mcp_server,
};

use commands::custom_agents_cmd::{
    create_custom_agent, delete_custom_agent, get_custom_agent, get_custom_agents,
    save_custom_agent,
};
use commands::hooks_cmd::{create_hook, delete_hook, get_hook, get_hooks, save_hook};
use commands::powers_cmd::{
    get_power, get_power_registries, get_powers, get_recommended_powers, install_power,
    uninstall_power,
};
use commands::proxy_cmd::detect_system_proxy;
use commands::skills_cmd::{
    create_skill, delete_skill, get_skill, get_skills, import_skill_from_github,
    import_skill_local, save_skill,
};
use commands::steering_cmd::{
    create_default_steering_file, create_initial_project_steering, create_steering_file,
    delete_steering_file, get_steering_file, get_steering_files, refine_steering_file,
    save_steering_file,
};
use commands::update_cmd::check_update;

use kiro::{get_kiro_local_token, read_kiro_accounts, switch_kiro_account};
use process::{close_kiro_ide, is_kiro_ide_running, start_kiro_ide};

/// 配置日志插件
fn setup_log_plugin() -> tauri_plugin_log::Builder {
    let log_level = gateway::load_gateway_config()
        .ok()
        .map(|config| match config.log_level.as_str() {
            "info" => log::LevelFilter::Info,
            "warn" => log::LevelFilter::Warn,
            "error" => log::LevelFilter::Error,
            _ => log::LevelFilter::Debug,
        })
        .unwrap_or(log::LevelFilter::Debug);

    tauri_plugin_log::Builder::new()
        .level(log_level)
        // 只显示我们自己的日志，过滤掉第三方库的日志
        .filter(|metadata| {
            let target = metadata.target();
            target.starts_with("kiro_account_manager")
        })
}

fn navigate_main_window_to_route(app_handle: &tauri::AppHandle, route: &str) {
    let Some(window) = app_handle.get_webview_window("main") else {
        log::warn!("收到 deep link，但未找到主窗口");
        return;
    };

    let (path, query) = route
        .split_once('?')
        .map_or((route, None), |(path, query)| (path, Some(query)));

    let navigation = || -> Result<(), String> {
        let mut url = window
            .url()
            .map_err(|e| format!("获取主窗口 URL 失败: {e}"))?;
        url.set_path(path);
        url.set_query(query);
        window
            .navigate(url)
            .map_err(|e| format!("跳转主窗口到 {route} 失败: {e}"))?;
        Ok(())
    };

    if let Err(err) = navigation() {
        log::error!("{err}");
    }
}

fn handle_incoming_deep_link(app_handle: &tauri::AppHandle, url: &str) {
    if let Some(route) = deep_link_handler::get_app_callback_route(url) {
        navigate_main_window_to_route(app_handle, &route);
    } else {
        deep_link_handler::handle_deep_link(url);
    }

    tray_behavior::show_main_window(app_handle);
}

/// 配置单实例插件回调
#[allow(clippy::needless_pass_by_value)] // Tauri 框架要求回调签名为 Vec<String>
fn setup_single_instance_callback(app: &tauri::AppHandle, argv: Vec<String>, _cwd: String) {
    // 当第二个实例尝试启动时，处理传入的参数（deep-link 回调）
    let protocol_prefix = format!(
        "{}://",
        deep_link_handler::DeepLinkCallbackWaiter::get_protocol_scheme()
    );
    for arg in &argv {
        if arg.starts_with(&protocol_prefix) {
            handle_incoming_deep_link(app, arg);
        }
    }
}

/// 处理 deep link 事件
fn handle_deep_link_event(app_handle: &tauri::AppHandle, payload: &str) {
    // payload 可能是 JSON 格式 ["kiro-account-manager://..."] 或纯 URL
    let url = if payload.starts_with('[') {
        // JSON 数组格式，解析第一个元素
        serde_json::from_str::<Vec<String>>(payload)
            .ok()
            .and_then(|v| v.into_iter().next())
            .unwrap_or_else(|| payload.to_string())
    } else if payload.starts_with('"') {
        // JSON 字符串格式
        serde_json::from_str::<String>(payload).unwrap_or_else(|_| payload.to_string())
    } else {
        payload.to_string()
    };

    // 只处理当前环境的协议
    let protocol_prefix = format!(
        "{}://",
        deep_link_handler::DeepLinkCallbackWaiter::get_protocol_scheme()
    );
    if !url.starts_with(&protocol_prefix) {
        return;
    }

    handle_incoming_deep_link(app_handle, &url);
}

/// 应用 setup 回调
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // 首次启动时检查命令行参数中的 deep link（Windows/Linux）
    let protocol_prefix = format!(
        "{}://",
        deep_link_handler::DeepLinkCallbackWaiter::get_protocol_scheme()
    );
    for arg in std::env::args() {
        if arg.starts_with(&protocol_prefix) {
            handle_incoming_deep_link(app.handle(), &arg);
        }
    }

    // 监听 deep link 事件（根据环境自动选择协议）
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        let scheme = deep_link_handler::DeepLinkCallbackWaiter::get_protocol_scheme();
        app.deep_link()
            .register(scheme)
            .map_err(|e| format!("Failed to register deep link: {e}"))?;
    }

    // 监听 deep link URL
    let app_handle = app.handle().clone();
    app.listen("deep-link://new-url", move |event| {
        handle_deep_link_event(&app_handle, event.payload());
    });

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = gateway::auto_start_if_enabled(&app_handle).await {
            log::error!("自动启动网关失败: {err}");
        }
    });

    match tray_behavior::create_tray_icon(app.handle()) {
        Ok(tray_icon) => {
            let state = app.state::<AppState>();
            state
                .tray_icon
                .lock()
                .expect("tray icon mutex poisoned")
                .replace(tray_icon);
            state
                .tray_ready
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
        Err(err) => {
            app.state::<AppState>()
                .tray_ready
                .store(false, std::sync::atomic::Ordering::Relaxed);
            log::warn!("系统托盘初始化失败，将继续启动但不启用关闭到托盘: {err}");
        }
    }

    Ok(())
}

#[allow(clippy::too_many_lines)] // Tauri 框架要求在 main 中注册所有命令，无法拆分
fn main() {
    tauri::Builder::default()
        .on_window_event(tray_behavior::handle_window_event)
        .plugin(setup_log_plugin().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        // 单实例插件：确保只有一个实例运行，deep-link 回调传递给已运行的实例
        .plugin(tauri_plugin_single_instance::init(
            setup_single_instance_callback,
        ))
        .manage(AppState {
            store: Mutex::new(AccountStore::new()),
            group_tag_store: Mutex::new(GroupTagStore::new()),
            auth: AuthState::new(),
            pending_login: Mutex::new(None),
            gateway: Mutex::new(None),
            tray_ready: AtomicBool::new(false),
            tray_icon: Mutex::new(None),
        })
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            // 账号命令
            get_accounts,
            delete_account,
            delete_accounts,
            delete_account_remote,
            update_account,
            sync_account,
            refresh_account_token,
            verify_account,
            add_account_by_social,
            add_local_kiro_account,
            add_account_by_idc,
            import_accounts,
            export_accounts,
            list_available_models,
            get_available_accounts,
            get_accounts_by_group,
            get_accounts_by_tag,
            get_account_usage,
            // Kiro CLI 导入命令
            get_kiro_cli_default_path,
            import_from_kiro_cli,
            // 分组与标签命令
            get_groups,
            add_group,
            update_group,
            delete_group,
            reorder_groups,
            get_tags,
            add_tag,
            update_tag,
            delete_tag,
            set_account_group,
            add_tag_to_account,
            remove_tag_from_account,
            set_account_tags,
            remove_account_tags,
            // Auth 命令
            get_current_user,
            logout,
            cancel_kiro_login,
            kiro_login,
            get_supported_providers,
            handle_kiro_social_callback,
            // Kiro IDE 命令
            get_kiro_local_token,
            switch_kiro_account,
            read_kiro_accounts,
            // 进程管理命令
            close_kiro_ide,
            start_kiro_ide,
            is_kiro_ide_running,
            // Kiro IDE 设置命令
            get_kiro_settings,
            set_kiro_proxy,
            set_kiro_model,
            set_kiro_codebase_indexing,
            set_kiro_trusted_commands,
            set_kiro_agent_autonomy,
            set_kiro_tab_autocomplete,
            set_kiro_usage_summary,
            set_kiro_code_references,
            set_kiro_debug_logs,
            set_kiro_notification,
            set_kiro_trusted_tools,
            set_kiro_reference_tracker,
            set_kiro_configure_mcp,
            set_kiro_telemetry,
            // 应用设置命令
            get_app_settings,
            save_app_settings,
            // 使用量历史记录命令
            get_usage_history,
            save_usage_history_entry,
            // 账号绑定机器码命令
            bind_machine_id_to_account,
            unbind_machine_id_from_account,
            get_bound_machine_id,
            get_all_bound_machine_ids,
            // 系统机器码命令
            get_system_machine_guid,
            backup_machine_guid,
            restore_machine_guid,
            reset_system_machine_guid,
            get_machine_guid_backup,
            set_custom_machine_guid,
            clear_macos_override,
            generate_machine_guid,
            restart_as_admin,
            // 浏览器检测
            detect_installed_browsers,
            // MCP 管理命令
            get_mcp_config,
            save_mcp_server,
            delete_mcp_server,
            toggle_mcp_server,
            get_mcp_tool_stats,
            // Gateway 命令
            start_gateway,
            stop_gateway,
            get_gateway_status,
            get_gateway_config,
            save_gateway_config,
            get_gateway_log_dir,
            get_gateway_request_logs,
            open_gateway_log_dir,
            clear_gateway_request_logs,
            // 代理检测命令
            detect_system_proxy,
            // 更新检查命令
            check_update,
            // Steering 管理命令
            get_steering_files,
            get_steering_file,
            save_steering_file,
            delete_steering_file,
            create_steering_file,
            create_default_steering_file,
            create_initial_project_steering,
            refine_steering_file,
            // Skills 管理命令
            get_skills,
            get_skill,
            save_skill,
            delete_skill,
            create_skill,
            import_skill_local,
            import_skill_from_github,
            // Hooks 管理命令
            get_hooks,
            get_hook,
            save_hook,
            delete_hook,
            create_hook,
            // Custom Agents 管理命令
            get_custom_agents,
            get_custom_agent,
            save_custom_agent,
            delete_custom_agent,
            create_custom_agent,
            // Powers 管理命令
            get_powers,
            get_power,
            install_power,
            uninstall_power,
            get_power_registries,
            get_recommended_powers
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
