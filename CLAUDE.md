# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kiro Account Manager is a Tauri 2.x desktop application for managing Kiro IDE accounts. It supports multi-account switching, quota monitoring, and automated account management across Windows, macOS, and Linux. The UI is Chinese-only (simplified Chinese).

## Development Commands

```bash
# Full app (frontend + backend) — this is the primary dev command
npm run tauri dev        # Runs Vite dev server (port 1420) + Rust backend together

# Frontend only
npm run dev              # Vite dev server at http://localhost:1420
npm run build            # Production frontend build

# Rust backend only (from src-tauri/)
cargo build              # Build backend
cargo test               # Run tests
cargo clippy             # Lint

# Production build
npm run tauri build      # Build distributable app for current platform

# i18n (Lingui — extract/compile scripts exist but the runtime uses i18next)
npm run extract          # Extract translatable strings
npm run compile          # Compile translations

# Release / local package
npm run release:patch    # 1.8.1 -> 1.8.2
npm run release:minor    # 1.8.1 -> 1.9.0
npm run release:major    # 1.8.1 -> 2.0.0
npm run build:release    # Run scripts/build-release.ps1
```

**Version sync**: The version number must stay in sync across three files: `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. The `standard-version` release scripts handle `package.json`; the other two must be updated manually or via the release script.

## Architecture

### Tech Stack
- **Frontend**: React 18 + Vite + TailwindCSS 4 + Mantine UI 7 + i18next (zh-CN only)
- **Backend**: Rust (edition 2021) + Tauri 2.x + reqwest + rusqlite
- **Persistence**: JSON files in `~/.kiro-account-manager/` (no database)

### Frontend → Backend Communication

All backend calls go through Tauri's `invoke()` IPC. The pattern is:

1. **Frontend**: `src/api/*.js` files wrap `invoke('command_name', { args })` calls
2. **Backend**: `src-tauri/src/commands/*_cmd.rs` files define `#[tauri::command]` handlers
3. **Registration**: All commands are registered in `main.rs` via `tauri::generate_handler![]`

When adding a new command: define the Rust function with `#[tauri::command]`, add it to `generate_handler![]` in `main.rs`, then call it from the frontend via `invoke()`.

### Key Architectural Patterns

**Provider Pattern for Authentication** (`src-tauri/src/providers/`):
- `base.rs` defines the `AuthProvider` trait with `login()`, `refresh_token()`, `get_provider_id()`, `get_auth_method()`
- `social.rs` — Google/GitHub OAuth via desktop auth API
- `idc.rs` — AWS IAM Identity Center (BuilderId + Enterprise)
- `factory.rs` — Provider instantiation

**Tauri Managed State** (`src-tauri/src/state.rs`):
- `AppState` holds all global state as `Mutex`-wrapped stores
- `AccountStore` / `GroupTagStore` — persist to JSON files on disk
- `AuthState` — in-memory auth state
- `PendingLogin` — temporary OAuth PKCE state during login flow
- Commands access state via `tauri::State<AppState>` parameter injection

**Deep Link OAuth Flow**:
- Protocol: `kiro-account-manager://` (production), `kiro-account-manager-dev://` (dev on Windows)
- `deep_link_handler.rs` handles incoming URLs
- `auth_social.rs` initiates OAuth with PKCE
- Frontend `AuthCallback` component (`src/components/shared/`) shows result
- Single-instance plugin ensures deep links route to the already-running app

**Machine ID Management** (`src-tauri/src/commands/machine_guid/`):
- Platform-specific implementations: `windows.rs` (registry), `macos.rs` (IOPlatformUUID), `linux.rs` (`/etc/machine-id`)
- Used for Kiro IDE account binding; switching accounts may require resetting the system machine ID

**Auto Account Switching** (`src-tauri/src/auto_switch.rs` + `src/hooks/useAutoSwitch.js`):
- Three strategies: `RoundRobin`, `MostQuota`, `Random`
- Frontend hook polls usage via Kiro portal API, triggers backend switch when quota exceeds threshold

### Frontend Structure

**Contexts** (wrap the entire app in `main.jsx`):
- `I18nProvider` → `AppSettingsProvider` → `ThemeProvider` → `DialogProvider`
- `AccountContext` provides account data to feature components

**Routing** (`src/routes.jsx`):
- Lazy-loaded page components: Home, AccountManager, KiroConfig, Login (desktop OAuth), Settings, About
- Internal route: AuthCallback (OAuth redirect handler)
- No router library; uses a simple route config array with sidebar navigation

**Kiro IDE Integration** (`src-tauri/src/kiro.rs`):
- Reads/writes `~/.kiro/config.json` (proxy, model settings)
- Reads/writes `~/.kiro/token.json` (current account tokens)
- Account switching = update token.json + optionally reset machine ID
- MCP config: `~/.kiro/settings/mcp.json`
- Steering rules: `~/.kiro/steering/*.md`

## Data Storage

App data in `~/.kiro-account-manager/`: `accounts.json`, `groups-tags.json`, `settings.json`, `usage-history.json`, `machine-bindings.json`

Kiro IDE data in `~/.kiro/`: `config.json`, `token.json`, `settings/mcp.json`, `steering/*.md`

## Important Implementation Details

- **Two auth methods**: `social` (Google/GitHub — `access_token`, `refresh_token`, `profile_arn`) and `IdC` (AWS IAM Identity Center — `client_id`, `client_secret`, `region`, `sso_session_id`). Enterprise IdC accounts may lack `email`; use `user_id` and `is_enterprise()` helper.
- **Token refresh**: Social uses `/refreshToken` endpoint; IdC uses AWS SSO OIDC `CreateToken`. Failed refreshes (401/423/403) mark accounts as banned.
- **Proxy**: Supports auto-detect (system proxy), custom URL, and TUN mode detection (198.18.0.0/15). Applied to both Rust HTTP client and Kiro IDE config.
- **Kiro IDE must be closed** before account switching. Always check `is_kiro_ide_running()` first.
- **Machine ID reset requires admin** on Windows — the app prompts for elevation via `restart_as_admin`.
- **Access tokens expire ~1 hour**. Always check `expires_at` and refresh before API calls.
- **Proxy changes require Kiro IDE restart** to take effect (the app syncs config but doesn't restart IDE).
- **Production builds**: Console logs stripped via terser; browser shortcuts (F5, F12, Ctrl+R, etc.) and right-click disabled.
- **Rust logging**: Filtered to `kiro_account_manager::*` only (see `setup_log_plugin()` in `main.rs`). Use `log::debug!()`, `log::info!()`, etc.

## UI Style Safety Rules (Mandatory)

These rules are mandatory for all future UI changes and fixes:

- **No low-contrast combinations in dark theme**: never allow light background + light text, or dark background + dark text in interactive controls.
- **Placeholders must be unified**: all input placeholders (TextInput/Textarea/Select/MultiSelect/NumberInput) must use shared light/dark tokens, not per-page ad-hoc colors.
- **Dropdown hover/selected must be visible**: all combobox options (Select/MultiSelect) must have explicit hover and selected backgrounds in both themes.
- **Theme-level first, page-level second**: prefer centralized rules in `ThemeContext.jsx` and `src/index.css`; page overrides are only for layout-specific exceptions.
- **Regression check before handoff**: verify dark theme behavior for text color, placeholder color, and option hover/selected states before considering UI work complete.

## Related Projects

- **kiro-gateway**: OpenAI/Anthropic-compatible API gateway for Kiro accounts (separate repository)
