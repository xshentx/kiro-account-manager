// Providers 模块 - 认证提供者

mod base;
mod factory;
mod idc;
mod social;

pub use base::{AuthProvider, AuthResult, RefreshMetadata};
pub use factory::*;
pub use idc::{cancel_pending_login as cancel_pending_idc_login, IdcProvider};
pub use social::SocialProvider;
// KiroPortalClient 用于获取配额（GetUserUsageAndLimits）
pub use crate::kiro_portal_client::KiroPortalClient;
