export function dismissBootSplash(doc = document) {
  const splash = doc?.getElementById?.('boot-splash')
  if (!splash) return false

  splash.dataset.state = 'hidden'
  splash.remove()
  return true
}
