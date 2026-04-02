// Powers 管理命令

use crate::commands::common::run_blocking_task;
use crate::powers::{PowerInfo, PowersManager, RecommendedPower, RegistryInfo};
use tauri::command;

#[command]
pub async fn install_power(
    name: String,
    clone_url: String,
    path_in_repo: String,
    branch: String,
) -> Result<(), String> {
    run_blocking_task(move || PowersManager::install(&name, &clone_url, &path_in_repo, &branch))
        .await
}

#[command]
pub async fn get_powers() -> Result<Vec<PowerInfo>, String> {
    run_blocking_task(PowersManager::load_all).await
}

#[command]
pub async fn get_power(name: String) -> Result<PowerInfo, String> {
    run_blocking_task(move || PowersManager::load(&name)).await
}

#[command]
pub async fn uninstall_power(name: String) -> Result<(), String> {
    run_blocking_task(move || PowersManager::uninstall(&name)).await
}

#[command]
pub async fn get_power_registries() -> Result<Vec<RegistryInfo>, String> {
    run_blocking_task(PowersManager::list_registries).await
}

#[command]
pub async fn get_recommended_powers() -> Result<Vec<RecommendedPower>, String> {
    PowersManager::fetch_recommended().await
}
