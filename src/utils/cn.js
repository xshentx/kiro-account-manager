// clsx 工具函数 - 用于合并类名
import clsx from 'clsx'

/**
 * 合并类名
 * @param {...any} inputs - 类名参数
 * @returns {string} 合并后的类名
 * 
 * @example
 * cn('text-red-500', isActive && 'bg-blue-500', { 'font-bold': isBold })
 */
export function cn(...inputs) {
  return clsx(inputs)
}
