// Toast 通知工具
import toast from 'react-hot-toast'

// 用于防止重复显示相同消息
const activeToasts = new Map()

/**
 * 防重复显示的包装函数
 */
const showToastOnce = (toastFn, message, options = {}) => {
  // 如果相同消息已经在显示，直接返回
  if (activeToasts.has(message)) {
    return activeToasts.get(message)
  }

  // 显示新的 toast
  const toastId = toastFn(message, options)
  activeToasts.set(message, toastId)

  // 在 toast 消失后清理记录
  setTimeout(() => {
    activeToasts.delete(message)
  }, options.duration || 3000)

  return toastId
}

/**
 * 成功提示
 */
export const showSuccess = (message, options = {}) => {
  return showToastOnce(
    (msg, opts) => toast.success(msg, opts),
    message,
    {
      duration: 3000,
      position: 'top-center',
      style: {
        background: '#10b981',
        color: '#fff',
        borderRadius: '12px',
        padding: '12px 20px',
      },
      ...options,
    }
  )
}

/**
 * 错误提示
 */
export const showError = (message, options = {}) => {
  return showToastOnce(
    (msg, opts) => toast.error(msg, opts),
    message,
    {
      duration: 4000,
      position: 'top-center',
      style: {
        background: '#ef4444',
        color: '#fff',
        borderRadius: '12px',
        padding: '12px 20px',
      },
      ...options,
    }
  )
}

/**
 * 警告提示
 */
export const showWarning = (message, options = {}) => {
  return showToastOnce(
    (msg, opts) => toast(msg, opts),
    message,
    {
      duration: 3500,
      position: 'top-center',
      icon: '⚠️',
      style: {
        background: '#f59e0b',
        color: '#fff',
        borderRadius: '12px',
        padding: '12px 20px',
      },
      ...options,
    }
  )
}

/**
 * 普通提示
 */
export const showInfo = (message, options = {}) => {
  return showToastOnce(
    (msg, opts) => toast(msg, opts),
    message,
    {
      duration: 3000,
      position: 'top-center',
      icon: 'ℹ️',
      style: {
        background: '#3b82f6',
        color: '#fff',
        borderRadius: '12px',
        padding: '12px 20px',
      },
      ...options,
    }
  )
}

/**
 * 加载提示
 */
export const showLoading = (message = '加载中...', options = {}) => {
  return toast.loading(message, {
    position: 'top-center',
    style: {
      background: '#6366f1',
      color: '#fff',
      borderRadius: '12px',
      padding: '12px 20px',
    },
    ...options,
  })
}

/**
 * Promise 提示（自动处理成功/失败）
 */
export const showPromise = (promise, messages = {}) => {
  return toast.promise(
    promise,
    {
      loading: messages.loading || '处理中...',
      success: messages.success || '操作成功',
      error: messages.error || '操作失败',
    },
    {
      position: 'top-center',
      style: {
        borderRadius: '12px',
        padding: '12px 20px',
      },
    }
  )
}

/**
 * 注意：确认对话框请使用 DialogContext 的 showConfirm
 * import { useDialog } from '@/contexts/DialogContext'
 * const { showConfirm } = useDialog()
 * const confirmed = await showConfirm('标题', '消息')
 */

export default toast
