const LIGHT_THEME_NAMES = Object.freeze(['light', 'purple', 'green'])

const MANTINE_PRIMARY_COLORS = Object.freeze({
  light: 'blue',
  dark: 'indigo',
  purple: 'grape',
  green: 'green',
})

export function isLightTheme(theme) {
  return LIGHT_THEME_NAMES.includes(theme)
}

export function getMantinePrimaryColor(theme) {
  return MANTINE_PRIMARY_COLORS[theme] || MANTINE_PRIMARY_COLORS.light
}
