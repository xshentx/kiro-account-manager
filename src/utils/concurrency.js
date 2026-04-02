/**
 * 并发控制工具
 */

/**
 * 根据任务数量计算并发数
 * @param {number} count - 任务数量
 * @returns {number} 并发数
 */
export const getConcurrency = (count) => {
  if (count <= 10) return 10
  if (count <= 50) return 30
  if (count <= 100) return 50
  if (count <= 200) return 80
  if (count <= 500) return 100
  return 150
}

/**
 * 分批执行异步任务
 * @param {Array<Function>} tasks - 任务函数数组，每个函数返回 Promise
 * @param {number} concurrency - 并发数
 * @param {Function} onProgress - 进度回调 (completed, total)
 * @returns {Promise<Array>} 所有任务的结果
 */
export const runWithConcurrency = async (tasks, concurrency, onProgress) => {
  const results = []
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(batch.map(fn => fn()))
    results.push(...batchResults)
    
    if (onProgress) {
      onProgress(Math.min(i + concurrency, tasks.length), tasks.length)
    }
  }
  return results
}
