// Hooks 管理命令

use crate::commands::common::run_blocking_task;
use crate::hooks::{HookFile, HooksManager};
use tauri::command;

#[command]
pub async fn get_hooks(project_dir: Option<String>) -> Result<Vec<HookFile>, String> {
    run_blocking_task(move || HooksManager::load_all(project_dir.as_deref())).await
}

#[command]
pub async fn get_hook(file_name: String, project_dir: Option<String>) -> Result<HookFile, String> {
    run_blocking_task(move || HooksManager::load(&file_name, project_dir.as_deref())).await
}

#[command]
pub async fn save_hook(
    file_name: String,
    content: String,
    project_dir: Option<String>,
) -> Result<(), String> {
    run_blocking_task(move || HooksManager::save(&file_name, &content, project_dir.as_deref()))
        .await
}

#[command]
pub async fn delete_hook(file_name: String, project_dir: Option<String>) -> Result<(), String> {
    run_blocking_task(move || HooksManager::delete(&file_name, project_dir.as_deref())).await
}

#[command]
pub async fn create_hook(
    file_name: String,
    content: String,
    project_dir: Option<String>,
) -> Result<HookFile, String> {
    run_blocking_task(move || HooksManager::create(&file_name, &content, project_dir.as_deref()))
        .await
}
