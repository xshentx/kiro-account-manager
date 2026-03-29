// i18n 工具函数（仅支持中文）
import i18n from 'i18next'

// 切换语言（保留接口兼容性）
export const changeLanguage = async (lng) => {
  await i18n.changeLanguage(lng || 'zh-CN')
}
