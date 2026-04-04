import { useState, useRef, useEffect } from 'react'
import { X, ChevronDown, Tag } from 'lucide-react'
import { useTheme } from '../../../contexts/ThemeContext'
import { getThemeAccent } from '../KiroConfig/themeAccent'
import { isPointerInsideContainer } from './utils/pointerInside'

/**
 * 可搜索的标签选择下拉框
 */
function SearchableTagSelect({
  tags = [],
  value,
  onChange,
  placeholder = '搜索标签...',
  showAllOption = false,
  showNoneOption = false,
  allLabel = '全部',
  noneLabel = '无标签',
  hasLabel = '有标签',
  className = '',
}) {
  const { colors, theme } = useTheme()
  const accent = getThemeAccent(theme)
  const activeOptionClass = `${accent.bgSoft} ${accent.text} font-medium`
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !isPointerInsideContainer(e, containerRef.current)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 打开时聚焦输入框
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  // 过滤标签
  const filteredTags = tags.filter(tag => 
    tag.name.toLowerCase().includes(search.toLowerCase())
  )

  // 获取当前选中的标签
  const selectedTag = tags.find(t => t.id === value)

  // 选择标签
  const handleSelect = (tagId) => {
    onChange(tagId)
    setOpen(false)
    setSearch('')
  }

  // 显示文本
  const displayText = value === '__none__' ? noneLabel : value === '__has__' ? hasLabel : (selectedTag?.name || '')

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* 输入框（可搜索） */}
      <div className={`w-full flex items-center border rounded-xl text-sm ${colors.input} ${colors.inputFocus} ${open ? `ring-2 ${accent.ring} ${accent.border}` : ''} transition-all cursor-pointer`}>
        {selectedTag && (
          <span className="ml-4 w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selectedTag.color }} />
        )}
        <input
          ref={inputRef}
          type="text"
          value={open ? search : displayText}
          onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={`flex-1 px-4 py-3 bg-transparent text-sm ${colors.text} focus:outline-none cursor-pointer`}
        />
        {value && (
          <button 
            type="button" 
            onClick={(e) => { e.stopPropagation(); onChange(null); setSearch('') }} 
            className={`p-1.5 mr-1 rounded-lg ${colors.cardHover} hover:bg-red-500/10 transition-all hover:scale-110 active:scale-95`}
            title="清空"
          >
            <X size={14} className="text-red-500" strokeWidth={2.5} />
          </button>
        )}
        <button type="button" onClick={() => setOpen(!open)} className="pr-4">
          <ChevronDown size={16} className={`${colors.textMuted} transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2.5} />
        </button>
      </div>

      {/* 下拉面板 */}
      {open && (
        <div className={`absolute left-0 right-0 top-full mt-2 ${colors.card} border ${colors.cardBorder} rounded-xl shadow-xl z-50 overflow-hidden`}>
          <div className="max-h-56 overflow-y-auto">
            {/* 全部选项 */}
            {showAllOption && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className={`w-full px-4 py-3 text-left text-sm flex items-center gap-2.5 transition-all ${
                  !value ? activeOptionClass : `${colors.text} ${colors.cardHover}`
                }`}
              >
                <Tag size={16} className={colors.textMuted} strokeWidth={2.5} />
                {allLabel}
              </button>
            )}

            {/* 有标签选项 */}
            {showNoneOption && (
              <button
                type="button"
                onClick={() => handleSelect('__has__')}
                className={`w-full px-4 py-3 text-left text-sm flex items-center gap-2.5 transition-all ${
                  value === '__has__' ? activeOptionClass : `${colors.text} ${colors.cardHover}`
                }`}
              >
                <span className={`w-3 h-3 rounded-full ${accent.solidBg}`} />
                {hasLabel}
              </button>
            )}

            {/* 无标签选项 */}
            {showNoneOption && (
              <button
                type="button"
                onClick={() => handleSelect('__none__')}
                className={`w-full px-4 py-3 text-left text-sm flex items-center gap-2.5 transition-all ${
                  value === '__none__' ? activeOptionClass : `${colors.text} ${colors.cardHover}`
                }`}
              >
                <span className={`w-3 h-3 rounded-full border-2 border-dashed ${colors.cardBorder}`} />
                {noneLabel}
              </button>
            )}

            {/* 标签列表 */}
            {filteredTags.length > 0 ? (
              filteredTags.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleSelect(tag.id)}
                  className={`w-full px-4 py-3 text-left text-sm flex items-center gap-2.5 transition-all ${
                    value === tag.id ? activeOptionClass : `${colors.text} ${colors.cardHover}`
                  }`}
                >
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </button>
              ))
            ) : search ? (
              <div className={`px-4 py-6 text-center text-sm ${colors.textMuted}`}>
                未找到匹配的标签
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

export default SearchableTagSelect
