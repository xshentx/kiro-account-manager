(function () {
  try {
    const theme = localStorage.getItem('theme') || 'light'
    const colors = {
      light: '#f5f5f5',
      dark: '#0f0f0f',
      purple: '#1a0f2e',
      green: '#0f1f0f',
    }
    document.body.style.backgroundColor = colors[theme] || colors.light
  } catch (e) {
    document.body.style.backgroundColor = '#f5f5f5'
  }
})()
