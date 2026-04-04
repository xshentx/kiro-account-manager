export function isPointerInsideContainer(event, container) {
  if (!event || !container) return false

  if (typeof container.contains === 'function' && container.contains(event.target)) {
    return true
  }

  if (typeof event.composedPath === 'function') {
    const path = event.composedPath()
    if (Array.isArray(path) && path.includes(container)) {
      return true
    }
  }

  if (typeof container.getBoundingClientRect !== 'function') {
    return false
  }

  const { clientX, clientY } = event
  if (typeof clientX !== 'number' || typeof clientY !== 'number') {
    return false
  }

  const rect = container.getBoundingClientRect()
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  )
}
