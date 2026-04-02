export const AI_MODELS = [
  { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5 - 1.3x', recommended: true },
  { value: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6 - 1.3x', recommended: false },
  { value: 'claude-sonnet-4', label: 'Claude Sonnet 4 - 1.3x', recommended: false },
  { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet - 1.0x', recommended: false },
  { value: 'claude-haiku-4.5', label: 'Claude Haiku 4.5 - 0.4x', recommended: false },
  { value: 'claude-opus-4.5', label: 'Claude Opus 4.5 - 2.2x', recommended: false },
  { value: 'claude-opus-4.6', label: 'Claude Opus 4.6 - 2.2x', recommended: false },
]

export const NOTIFICATION_SETTINGS_FIELD_MAP = {
  'kiroAgent.notifications.agent.actionRequired': 'notifyActionRequired',
  'kiroAgent.notifications.agent.failure': 'notifyFailure',
  'kiroAgent.notifications.agent.success': 'notifySuccess',
  'kiroAgent.notifications.billing': 'notifyBilling',
}

export const buildThemeOptions = (t) => [
  { key: 'light', name: t('settings.light'), iconName: 'Sun', color: 'from-blue-400 to-blue-600' },
  { key: 'dark', name: t('settings.dark'), iconName: 'Moon', color: 'from-gray-700 to-gray-900' },
  { key: 'purple', name: t('settings.purple'), iconName: 'Palette', color: 'from-purple-500 to-purple-700' },
  { key: 'green', name: t('settings.green'), iconName: 'Palette', color: 'from-emerald-500 to-emerald-700' },
]
