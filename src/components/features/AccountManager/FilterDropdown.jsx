import { useState, useRef, useEffect } from 'react'
import { Filter, X, ChevronDown } from 'lucide-react'
import { useTheme } from '../../../contexts/ThemeContext'
import { useTranslation } from 'react-i18next'
import SearchableTagSelect from './SearchableTagSelect'
import { getThemeAccent } from '../KiroConfig/themeAccent'
import { buildFilterSummaryItems, countActiveFilters } from './utils/filterDropdownState'

const SUBSCRIPTION_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'FREE', label: 'FREE' },
  { value: 'KIRO FREE', label: 'KIRO FREE' },
  { value: 'KIRO PRO', label: 'KIRO PRO' },
  { value: 'KIRO PRO+', label: 'KIRO PRO+' },
  { value: 'KIRO POWER', label: 'KIRO POWER' },
]
const STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'normal', label: '正常' },
  { value: 'capped', label: '封顶' },
  { value: 'banned', label: '封禁' },
  { value: 'invalid', label: '失效' },
  { value: 'expired', label: '过期' },
]
const PROVIDER_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'Google', label: 'Google' },
  { value: 'Github', label: 'Github' },
  { value: 'BuilderId', label: 'BuilderId' },
  { value: 'Enterprise', label: 'Enterprise' },
]
const USAGE_RANGE_OPTIONS = [
  { value: '', label: '全部' },
  { value: '0-500', label: '0-500' },
  { value: '500-1000', label: '500-1000' },
  { value: '1000-2000', label: '1000-2000' },
  { value: '2000-+', label: '2000+' },
]

function SectionCard({ title, subtitle, children, colors }) {
  return (
    <section className={`rounded-xl border ${colors.cardBorder} ${colors.cardSecondary} p-3 space-y-3`}>
      <div>
        <h4 className={`text-sm font-semibold ${colors.text}`}>{title}</h4>
        {subtitle && <p className={`mt-1 text-[11px] ${colors.textMuted}`}>{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

function FilterSelect({ label, value, options, onChange, onClear, colors }) {
  const displayValue = Array.isArray(value) ? (value[0] || '') : (value || '')
  const hasValue = displayValue !== ''

  return (
    <div>
      <label className={`block text-xs font-medium ${colors.textMuted} mb-2`}>
        {label}
      </label>
      <div className="relative">
        <select
          value={displayValue}
          onChange={(e) => {
            const nextValue = e.target.value
            if (nextValue === '') {
              onClear?.()
            } else {
              onChange(nextValue)
            }
          }}
          className={`w-full px-3 py-2.5 ${hasValue ? 'pr-9' : 'pr-3'} text-sm rounded-lg border ${colors.input} ${colors.inputFocus} ${colors.text} transition-all duration-200 cursor-pointer shadow-sm`}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {hasValue && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClear?.()
            }}
            className={`cursor-pointer absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded ${colors.cardHover} hover:bg-red-500/10 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500/60`}
            title="清空"
          >
            <X size={12} className="text-red-500" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  )
}

function FilterDropdown({
  filters,
  onFiltersChange,
  allGroups = [],
  selectedGroup,
  onGroupFilter,
  allTags = [],
  selectedTag,
  onTagFilter,
  defaultGroupCollapsed = false,
}) {
  const { colors, theme } = useTheme()
  const accent = getThemeAccent(theme)
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [showGroupSection, setShowGroupSection] = useState(() => !defaultGroupCollapsed)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (selectedGroup) {
      setShowGroupSection(true)
    }
  }, [selectedGroup])

  const activeCount = countActiveFilters({ filters, selectedGroup, selectedTag })
  const summaryItems = buildFilterSummaryItems({
    filters,
    selectedGroup,
    selectedTag,
    allGroups,
    allTags,
  })

  const clearAll = () => {
    onFiltersChange({ subscriptions: [], statuses: [], providers: [], usageRange: null })
    onGroupFilter?.(null)
    onTagFilter(null)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`
          cursor-pointer flex items-center gap-2.5 px-3 py-2.5
          ${colors.card} border-2 ${colors.cardBorder}
          rounded-xl ${colors.cardHover}
          transition-all duration-200
          shadow-sm hover:shadow-md focus:outline-none focus:ring-2 ${accent.ring}
          ${activeCount > 0 ? `${accent.border} ${accent.bgSoft} ${accent.shadow}` : ''}
          ${open ? `ring-2 ${accent.ring}` : ''}
        `}
        title={t('filter.title')}
        aria-label={t('filter.title')}
      >
        <div className={`
          w-8 h-8 rounded-lg flex items-center justify-center
          ${activeCount > 0 ? `bg-gradient-to-br ${accent.gradientFrom} ${accent.gradientTo} shadow-lg ${accent.shadow}` : `${colors.cardSecondary}`}
          transition-all duration-200
        `}>
          <Filter
            size={16}
            className={activeCount > 0 ? 'text-white' : colors.textMuted}
            strokeWidth={2.5}
          />
        </div>
        {activeCount > 0 && (
          <span className={`px-2 py-0.5 bg-gradient-to-r ${accent.gradientFrom} ${accent.gradientTo} text-white text-xs rounded-full font-bold min-w-[20px] text-center shadow-lg ${accent.shadow}`}>
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`
            absolute right-0 top-full mt-3 w-[420px] max-w-[calc(100vw-48px)]
            ${colors.card} border ${colors.cardBorder}
            rounded-2xl shadow-2xl z-50
            overflow-hidden
          `}
          style={{
            animation: 'slideDown 0.2s ease-out',
            boxShadow: '0 20px 40px -12px rgba(0, 0, 0, 0.25)',
          }}
        >
          <div className={`px-4 py-4 border-b ${colors.cardBorder} space-y-3`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${accent.gradientFrom} ${accent.gradientTo} shadow-lg ${accent.shadow}`}>
                  <Filter size={18} className="text-white" strokeWidth={2.5} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${colors.text}`}>{t('filter.title')}</span>
                    {activeCount > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${accent.bgSoft} ${accent.text}`}>
                        {activeCount} 项生效
                      </span>
                    )}
                  </div>
                  <p className={`mt-1 text-xs ${colors.textMuted}`}>
                    组合分组、标签、状态和配额条件，快速收敛账号列表。
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activeCount > 0 && (
                  <button
                    onClick={clearAll}
                    className={`cursor-pointer text-xs ${colors.textMuted} hover:text-red-500 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500/60`}
                  >
                    <X size={12} strokeWidth={2.5} />
                    清空
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className={`cursor-pointer rounded-lg border ${colors.cardBorder} px-2.5 py-1.5 text-xs ${colors.textMuted} ${colors.cardHover} transition-all duration-200 focus:outline-none focus:ring-2 ${accent.ring}`}
                >
                  关闭
                </button>
              </div>
            </div>
            {summaryItems.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {summaryItems.map(item => (
                  <span
                    key={item.key}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${colors.cardBorder} ${colors.cardSecondary} ${colors.text}`}
                  >
                    <span className={colors.textMuted}>{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 space-y-4 max-h-[480px] overflow-y-auto custom-scrollbar max-w-full">
            {(allGroups.length > 0 || allTags.length > 0) && (
              <SectionCard
                title="基础筛选"
                subtitle="优先按分组和标签缩小范围，最适合高频定位。"
                colors={colors}
              >
                {allGroups.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowGroupSection(prev => !prev)}
                      className={`cursor-pointer w-full flex items-center justify-between text-xs font-medium ${colors.textMuted} mb-2 px-2 py-1.5 rounded-lg ${colors.cardHover} transition-colors duration-200 focus:outline-none focus:ring-2 ${accent.ring}`}
                    >
                      <span>{(t('groups.title') || '分组') + (showGroupSection ? '' : '（已折叠）')}</span>
                      <ChevronDown size={14} className={`transition-transform duration-200 ${showGroupSection ? 'rotate-180' : ''}`} />
                    </button>
                    {showGroupSection && (
                      <SearchableTagSelect
                        tags={allGroups}
                        value={selectedGroup}
                        onChange={onGroupFilter}
                        placeholder={t('groups.searchPlaceholder') || '搜索分组...'}
                        showAllOption={true}
                        showNoneOption={true}
                        allLabel={t('groups.all') || '全部'}
                        noneLabel={t('groups.noGroup') || '无分组'}
                        hasLabel={t('groups.hasGroup') || '有分组'}
                      />
                    )}
                  </div>
                )}

                {allTags.length > 0 && (
                  <div>
                    <label className={`block text-xs font-medium ${colors.textMuted} mb-2`}>
                      {t('tags.title')}
                    </label>
                    <SearchableTagSelect
                      tags={allTags}
                      value={selectedTag}
                      onChange={onTagFilter}
                      placeholder={t('tags.searchPlaceholder') || '搜索标签...'}
                      showAllOption={true}
                      showNoneOption={true}
                      allLabel={t('tags.all')}
                      noneLabel={t('tags.noTags')}
                      hasLabel={t('tags.hasTags') || '有标签'}
                    />
                  </div>
                )}
              </SectionCard>
            )}

            <SectionCard
              title="高级筛选"
              subtitle="按订阅、状态、登录方式和使用量进一步精确收敛。"
              colors={colors}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FilterSelect
                  label={t('filter.subscription')}
                  value={filters.subscriptions?.length > 0 ? filters.subscriptions[0] : ''}
                  options={SUBSCRIPTION_OPTIONS}
                  onChange={(value) => onFiltersChange({ ...filters, subscriptions: [value] })}
                  onClear={() => onFiltersChange({ ...filters, subscriptions: [] })}
                  colors={colors}
                />

                <FilterSelect
                  label={t('filter.status')}
                  value={filters.statuses?.length > 0 ? filters.statuses[0] : ''}
                  options={STATUS_OPTIONS}
                  onChange={(value) => onFiltersChange({ ...filters, statuses: [value] })}
                  onClear={() => onFiltersChange({ ...filters, statuses: [] })}
                  colors={colors}
                />

                <FilterSelect
                  label={t('filter.provider')}
                  value={filters.providers?.length > 0 ? filters.providers[0] : ''}
                  options={PROVIDER_OPTIONS}
                  onChange={(value) => onFiltersChange({ ...filters, providers: [value] })}
                  onClear={() => onFiltersChange({ ...filters, providers: [] })}
                  colors={colors}
                />

                <FilterSelect
                  label="使用量"
                  value={filters.usageRange || ''}
                  options={USAGE_RANGE_OPTIONS}
                  onChange={(value) => onFiltersChange({ ...filters, usageRange: value })}
                  onClear={() => onFiltersChange({ ...filters, usageRange: null })}
                  colors={colors}
                />
              </div>
            </SectionCard>
          </div>

          <div className={`flex items-center justify-between gap-3 border-t ${colors.cardBorder} px-4 py-3 ${colors.card}`}>
            <span className={`text-xs ${colors.textMuted}`}>
              {activeCount > 0 ? `当前已启用 ${activeCount} 个筛选条件` : '未启用筛选条件'}
            </span>
            <div className="flex items-center gap-2">
              {activeCount > 0 && (
                <button
                  onClick={clearAll}
                  className="cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-red-500 transition-all duration-200 hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500/60"
                >
                  一键清空
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className={`cursor-pointer rounded-lg px-3 py-2 text-xs font-medium ${accent.text} ${accent.bgSoft} transition-all duration-200 hover:opacity-90 focus:outline-none focus:ring-2 ${accent.ring}`}
              >
                完成
              </button>
            </div>
          </div>

          <style>{`
            .custom-scrollbar::-webkit-scrollbar {
              width: 6px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
              background: transparent;
              margin: 4px 0;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
              background: var(--mantine-primary-color-filled);
              border-radius: 3px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
              background: var(--mantine-primary-color-filled-hover);
            }
          `}</style>
        </div>
      )}
    </div>
  )
}

export default FilterDropdown
