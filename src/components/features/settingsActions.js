export const buildSettingsErrorMessage = (t, err, titleKey = 'settings.saveFailed') => {
  const title = t(titleKey)
  return {
    title,
    message: `${title}: ${err}`,
  }
}

export const persistAppSettings = async ({
  updates,
  notifyChange = false,
  updateAppSettings,
  emitFn,
  showError,
  t,
}) => {
  try {
    const nextSettings = await updateAppSettings(updates)
    if (!nextSettings) {
      await showError(t('settings.saveFailed'), t('settings.saveFailed'))
      return null
    }
    if (notifyChange) {
      await emitFn('settings-changed')
    }
    await emitFn('app-settings-changed', nextSettings)
    return nextSettings
  } catch (err) {
    const errorInfo = buildSettingsErrorMessage(t, err)
    await showError(errorInfo.title, errorInfo.message)
    return null
  }
}

export const runKiroCommandWithAppSettings = async ({
  command,
  commandArgs,
  appSettingsUpdates,
  notifyChange = false,
  invokeFn,
  persistSettings,
  showError,
  t,
}) => {
  try {
    await invokeFn(command, commandArgs)
    if (appSettingsUpdates) {
      return await persistSettings({
        updates: appSettingsUpdates,
        notifyChange,
      })
    }
    return true
  } catch (err) {
    const errorInfo = buildSettingsErrorMessage(t, err)
    await showError(errorInfo.title, errorInfo.message)
    return null
  }
}
