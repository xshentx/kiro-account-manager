// Provider Factory - 根据 provider 创建对应的认证提供者
// 参考 kiro-batch-login/src/providers/provider-factory.js

use super::IdcProvider;

/// 认证方式
#[derive(Debug, Clone, PartialEq)]
pub enum AuthMethod {
    Social,
    Idc,
}

/// Provider 配置
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub provider_id: String,
    pub auth_method: AuthMethod,
    pub region: String,
    pub start_url: Option<String>,
}

/// 获取 provider 配置
pub fn get_provider_config(provider: &str) -> Option<ProviderConfig> {
    match provider {
        "Google" => Some(ProviderConfig {
            provider_id: "Google".to_string(),
            auth_method: AuthMethod::Social,
            region: "us-east-1".to_string(),
            start_url: None,
        }),
        "Github" => Some(ProviderConfig {
            provider_id: "Github".to_string(),
            auth_method: AuthMethod::Social,
            region: "us-east-1".to_string(),
            start_url: None,
        }),
        "BuilderId" => Some(ProviderConfig {
            provider_id: "BuilderId".to_string(),
            auth_method: AuthMethod::Idc,
            region: "us-east-1".to_string(),
            start_url: Some("https://view.awsapps.com/start".to_string()),
        }),
        "Enterprise" => Some(ProviderConfig {
            provider_id: "Enterprise".to_string(),
            auth_method: AuthMethod::Idc,
            region: "us-east-1".to_string(),
            start_url: Some("https://view.awsapps.com/start".to_string()), // 默认使用 BuilderId URL，用户可以自定义
        }),
        _ => None,
    }
}

/// 获取支持的 providers
pub fn get_supported_providers() -> Vec<&'static str> {
    vec!["Google", "Github", "BuilderId", "Enterprise"]
}

/// 创建 `IdC` Provider
pub fn create_idc_provider(config: &ProviderConfig) -> IdcProvider {
    IdcProvider::new(
        &config.provider_id,
        &config.region,
        config.start_url.clone(),
    )
}
