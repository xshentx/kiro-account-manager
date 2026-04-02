import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useApp } from '../../../hooks/useApp'
import { useDialog } from '../../../contexts/DialogContext'
import { FileText, RefreshCw, Trash2, Save, Plus, X, Globe, FolderOpen, Wand2, Sparkles } from 'lucide-react'
import { TextInput, Select, Textarea } from '@mantine/core'
import {
  getThemeAccent,
  getSolidAccentButton,
  getGradientAccentButton,
  getThemeSurfaceStyles,
} from './themeAccent'
import { handleUiError } from '../../../utils/errorLogger'

// 解析 front-matter（v0.10.32: inclusion + name + description + fileMatchPattern）
const parseFrontMatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { inclusion: 'always', filePattern: '', name: '', description: '', body: content }
  const [, fm, body] = match
  return {
    inclusion: fm.match(/inclusion:\s*(\w+)/)?.[1] || 'always',
    filePattern: fm.match(/fileMatchPattern:\s*['"]?([^'"\n]+)['"]?/)?.[1] || '',
    name: fm.match(/name:\s*['"]?([^'"\n]+)['"]?/)?.[1]?.trim() || '',
    description: fm.match(/description:\s*['"]?([^'"\n]+)['"]?/)?.[1]?.trim() || '',
    body
  }
}

// 组装 front-matter（v0.10.32: inclusion + name + description + fileMatchPattern）
const buildContent = (inclusion, filePattern, body, name, description) => {
  let fm = `---\ninclusion: ${inclusion}`
  if (name?.trim()) fm += `\nname: "${name.trim()}"`
  if (description?.trim()) fm += `\ndescription: "${description.trim()}"`
  if (inclusion === 'fileMatch' && filePattern.trim()) fm += `\nfileMatchPattern: '${filePattern.trim()}'`
  return fm + '\n---\n' + body
}

// 格式化文件大小
const formatSize = (bytes) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

// scope 徽章
const ScopeBadge = ({ scope, accent }) => {
  if (scope === 'project') {
    return (
      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30">
        <FolderOpen size={10} />项目
      </span>
    )
  }
  return (
    <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${accent.scopeBadge}`}>
      <Globe size={10} />用户
    </span>
  )
}

function SteeringPanel({ onCountChange, projectDir }) {
  const { t, theme, colors } = useApp()
  const { showConfirm, showSuccess } = useDialog()
  const surface = getThemeSurfaceStyles(theme)
  const accent = getThemeAccent(theme)

  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState(null)
  const [editState, setEditState] = useState({ content: '', inclusion: 'always', filePattern: '', name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [refining, setRefining] = useState(false)
  const [creatingDefault, setCreatingDefault] = useState(false)
  const [initializingProject, setInitializingProject] = useState(false)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await invoke('get_steering_files', { projectDir: projectDir || null })
      setFiles(data)
      onCountChange?.(data?.length || 0)
    } catch (e) {
      handleUiError('加载 Steering 文件失败', e, { userMessage: '加载 Steering 文件失败' })
    } finally {
      setLoading(false)
    }
  }, [onCountChange, projectDir])

  useEffect(() => {
    setSelectedFile(null)
    setEditState({ content: '', inclusion: 'always', filePattern: '', name: '', description: '' })
    setHasChanges(false)
    loadFiles()
  }, [loadFiles])

  const handleSelect = async (file) => {
    if (hasChanges && !await showConfirm(t('steering.unsavedChanges'), t('steering.confirmSwitch'))) return
    setSelectedFile(file)
    const parsed = parseFrontMatter(file.content)
    setEditState({ content: parsed.body, inclusion: parsed.inclusion, filePattern: parsed.filePattern, name: parsed.name, description: parsed.description })
    setHasChanges(false)
  }

  const updateEditState = (key, value) => {
    const newState = { ...editState, [key]: value }
    setEditState(newState)
    if (selectedFile) {
      const newContent = buildContent(newState.inclusion, newState.filePattern, newState.content, newState.name, newState.description)
      setHasChanges(newContent !== selectedFile.content)
    }
  }

  const handleSave = async () => {
    if (!selectedFile) return
    setSaving(true)
    try {
      const fullContent = buildContent(editState.inclusion, editState.filePattern, editState.content, editState.name, editState.description)
      await invoke('save_steering_file', {
        fileName: selectedFile.fileName,
        content: fullContent,
        scope: selectedFile.scope,
        projectDir: projectDir || null
      })
      setFiles(files.map(f => (f.fileName === selectedFile.fileName && f.scope === selectedFile.scope) ? { ...f, content: fullContent } : f))
      setSelectedFile({ ...selectedFile, content: fullContent })
      setHasChanges(false)
    } catch (e) {
      handleUiError('保存 Steering 文件失败', e, { userMessage: t('steering.saveFailed') || '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (file) => {
    if (!await showConfirm(t('steering.confirmDelete'), t('steering.confirmDeleteFile', { fileName: file.fileName }))) return
    try {
      await invoke('delete_steering_file', {
        fileName: file.fileName,
        scope: file.scope,
        projectDir: projectDir || null
      })
      const newFiles = files.filter(f => !(f.fileName === file.fileName && f.scope === file.scope))
      setFiles(newFiles)
      onCountChange?.(newFiles.length)
      if (selectedFile?.fileName === file.fileName && selectedFile?.scope === file.scope) {
        setSelectedFile(null)
        setEditState({ content: '', inclusion: 'always', filePattern: '', name: '', description: '' })
        setHasChanges(false)
      }
    } catch (e) {
      handleUiError('删除 Steering 文件失败', e, { userMessage: '删除失败' })
    }
  }

  const handleCreate = async (fileName, inclusion, filePattern, scope, name, description) => {
    const fName = fileName.endsWith('.md') ? fileName : `${fileName}.md`
    const content = buildContent(inclusion, filePattern, '\n<!-- 在此添加你的 steering 规则 -->\n', name, description)
    try {
      const newFile = await invoke('create_steering_file', {
        fileName: fName,
        content,
        scope,
        projectDir: projectDir || null
      })
      const newFiles = [...files, newFile]
      setFiles(newFiles)
      onCountChange?.(newFiles.length)
      setShowCreateModal(false)
      handleSelect(newFile)
    } catch (e) {
      handleUiError('创建 Steering 文件失败', e, { userMessage: t('steering.createFailed') || '创建失败' })
    }
  }

  const resolveScope = async () => {
    if (!projectDir) return 'user'
    const useProjectScope = await showConfirm(
      t('steering.scopeTitle'),
      t('steering.scopeMessage'),
      {
        confirmText: t('kiroConfig.scopeProject'),
        cancelText: t('kiroConfig.scopeUser'),
      }
    )
    return useProjectScope ? 'project' : 'user'
  }

  const upsertFile = (nextFile) => {
    const nextFiles = [
      ...files.filter(file => !(file.fileName === nextFile.fileName && file.scope === nextFile.scope)),
      nextFile
    ]
    setFiles(nextFiles)
    onCountChange?.(nextFiles.length)
    handleSelect(nextFile)
  }

  const handleCreateDefault = async () => {
    setCreatingDefault(true)
    try {
      const scope = await resolveScope()
      const created = await invoke('create_default_steering_file', {
        scope,
        projectDir: projectDir || null,
      })
      upsertFile(created)
      showSuccess(t('steering.defaultCreated'), created.fileName)
    } catch (e) {
      handleUiError('创建默认 Steering 模板失败', e, { userMessage: t('steering.createDefaultFailed') || '创建失败' })
    } finally {
      setCreatingDefault(false)
    }
  }

  const handleCreateInitial = async () => {
    if (!projectDir) return
    setInitializingProject(true)
    try {
      const created = await invoke('create_initial_project_steering', { projectDir })
      const createdFiles = Array.isArray(created) ? created : []
      if (createdFiles.length > 0) {
        const merged = [...files]
        for (const file of createdFiles) {
          const index = merged.findIndex(item => item.fileName === file.fileName && item.scope === file.scope)
          if (index >= 0) {
            merged[index] = file
          } else {
            merged.push(file)
          }
        }
        setFiles(merged)
        onCountChange?.(merged.length)
        handleSelect(createdFiles[0])
      }
      showSuccess(t('steering.initialCreated'), projectDir)
    } catch (e) {
      handleUiError('初始化项目 Steering 失败', e, { userMessage: t('steering.initializeFailed') || '初始化失败' })
    } finally {
      setInitializingProject(false)
    }
  }

  const handleRefine = async () => {
    if (!selectedFile) return
    setRefining(true)
    try {
      const refined = await invoke('refine_steering_file', {
        fileName: selectedFile.fileName,
        scope: selectedFile.scope,
        projectDir: projectDir || null,
      })
      upsertFile(refined)
      showSuccess(t('steering.refineSuccess'), refined.fileName)
    } catch (e) {
      handleUiError('整理 Steering 文件失败', e, { userMessage: t('steering.refineFailed') || '整理失败' })
    } finally {
      setRefining(false)
    }
  }

  const inclusionOptions = [
    { value: 'always', label: t('steering.inclusionAlways'), desc: t('steering.inclusionAlwaysDesc') },
    { value: 'auto', label: t('steering.inclusionAuto'), desc: t('steering.inclusionAutoDesc') },
    { value: 'fileMatch', label: t('steering.inclusionFileMatch'), desc: t('steering.inclusionFileMatchDesc') },
    { value: 'manual', label: t('steering.inclusionManual'), desc: t('steering.inclusionManualDesc') },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className={`animate-spin ${accent.text}`} size={24} />
      </div>
    )
  }

  return (
    <div className="h-full flex gap-4 p-4">
      {/* 左侧列表 */}
      <FileList
        files={files}
        selectedFile={selectedFile}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onRefresh={loadFiles}
        onCreate={() => setShowCreateModal(true)}
        onCreateDefault={handleCreateDefault}
        onCreateInitial={handleCreateInitial}
        creatingDefault={creatingDefault}
        initializingProject={initializingProject}
        hasProjectDir={!!projectDir}
        accent={accent}
        colors={colors}
        t={t}
      />

      {/* 右侧编辑器 */}
      <div className={`flex-1 flex flex-col ${colors.card} border ${colors.cardBorder} rounded-2xl overflow-hidden shadow-lg`}>
        {selectedFile ? (
          <Editor
            file={selectedFile}
            editState={editState}
            hasChanges={hasChanges}
            saving={saving}
            inclusionOptions={inclusionOptions}
            onContentChange={(v) => updateEditState('content', v)}
            onInclusionChange={(v) => updateEditState('inclusion', v)}
            onFilePatternChange={(v) => updateEditState('filePattern', v)}
            onNameChange={(v) => updateEditState('name', v)}
            onDescriptionChange={(v) => updateEditState('description', v)}
            onSave={handleSave}
            onRefine={handleRefine}
            refining={refining}
            surface={surface}
            accent={accent}
            colors={colors}
            t={t}
          />
        ) : (
          <div className={`flex-1 flex items-center justify-center ${colors.textMuted}`}>
            <div className="text-center">
              <FileText size={48} className="mx-auto mb-2 opacity-30" />
              <p>{t('steering.selectToEdit')}</p>
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateModal
          inclusionOptions={inclusionOptions}
          onCreate={handleCreate}
          onClose={() => setShowCreateModal(false)}
          accent={accent}
          colors={colors}
          t={t}
          hasProjectDir={!!projectDir}
        />
      )}
    </div>
  )
}

// inclusion 模式配色映射
const getInclusionStyles = (accent) => ({
  always:    { color: 'text-green-500',  bg: 'bg-green-500/15', border: 'border-green-500/30', dot: 'bg-green-500', label: '始终' },
  auto:      { color: accent.text, bg: accent.bgSoft, border: accent.borderSoft, dot: accent.solidBg, label: '自动' },
  fileMatch: { color: accent.text, bg: accent.bgSoft, border: accent.borderSoft, dot: accent.solidBg, label: '匹配' },
  manual:    { color: 'text-orange-500', bg: 'bg-orange-500/15', border: 'border-orange-500/30', dot: 'bg-orange-500', label: '手动' },
})

// inclusion 徽章
const InclusionBadge = ({ inclusion, accent }) => {
  const styles = getInclusionStyles(accent)
  const s = styles[inclusion] || styles.always
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${s.bg} ${s.color} border ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

// 文件列表组件
function FileList({ files, selectedFile, onSelect, onDelete, onRefresh, onCreate, onCreateDefault, onCreateInitial, creatingDefault, initializingProject, hasProjectDir, accent, colors, t }) {
  const accentSolidButtonClass = getSolidAccentButton(accent)
  const inclusionStyles = getInclusionStyles(accent)
  // 按 inclusion 分组（保持顺序）
  const groups = [
    { key: 'always',    label: '始终包含' },
    { key: 'auto',      label: '自动激活' },
    { key: 'fileMatch', label: '文件匹配' },
    { key: 'manual',    label: '手动引用' },
  ].map(g => ({
    ...g,
    files: files.filter(f => parseFrontMatter(f.content).inclusion === g.key),
    style: inclusionStyles[g.key],
  })).filter(g => g.files.length > 0)

  return (
    <div className={`w-80 flex flex-col ${colors.card} border ${colors.cardBorder} rounded-2xl overflow-hidden shadow-lg`}>
      <div className={`p-4 border-b ${colors.cardBorder} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <FileText size={18} className={accent.text} />
          <span className={`text-sm font-semibold ${colors.text}`}>Steering</span>
          <span className={`text-xs ${colors.textMuted}`}>({files.length})</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCreateDefault}
            disabled={creatingDefault}
            className={`p-2 rounded-lg ${colors.cardHover} transition-colors disabled:opacity-50`}
            title={t('steering.defaultTemplate')}
          >
            <Wand2 size={16} className={accent.text} />
          </button>
          {hasProjectDir && (
            <button
              onClick={onCreateInitial}
              disabled={initializingProject}
              className={`p-2 rounded-lg ${colors.cardHover} transition-colors disabled:opacity-50`}
              title={t('steering.initializeProject')}
            >
              <Sparkles size={16} className={accent.text} />
            </button>
          )}
          <button
            onClick={onCreate}
            className={`p-2 rounded-lg ${colors.cardHover} transition-colors`}
            title={t('steering.newSteering')}
          >
              <Plus size={16} className={accent.text} />
          </button>
          <button
            onClick={onRefresh}
            className={`p-2 rounded-lg ${colors.cardHover} transition-colors`}
            title={t('common.refresh')}
          >
            <RefreshCw size={16} className={colors.textMuted} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {files.length === 0 ? (
          <div className={`text-center py-16 ${colors.textMuted}`}>
            <FileText size={48} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">{t('steering.noFiles')}</p>
            <button
              onClick={onCreate}
              className={`mt-4 px-4 py-2 rounded-lg text-sm transition-colors ${accentSolidButtonClass}`}
            >
              {t('steering.newSteering')}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map(group => (
              <div key={group.key}>
                {/* 分组标题 - 紧凑风格 */}
                <div className={`flex items-center gap-2 mb-2 px-1`}>
                  <span className={`w-2 h-2 rounded-full ${group.style.dot}`} />
                  <span className={`text-xs font-semibold ${colors.textMuted} uppercase tracking-wider`}>{group.label}</span>
                  <span className={`text-[10px] ${colors.textMuted} opacity-60`}>{group.files.length}</span>
                  <div className={`flex-1 h-px ${colors.cardBorder} opacity-50`} />
                </div>

                {/* 文件卡片 */}
                <div className="space-y-2">
                  {group.files.map(file => {
                    const parsed = parseFrontMatter(file.content)
                    const isSelected = selectedFile?.fileName === file.fileName && selectedFile?.scope === file.scope
                    return (
                      <div
                        key={`${file.scope}-${file.fileName}`}
                        onClick={() => onSelect(file)}
                        className={`p-3 rounded-xl cursor-pointer group transition-all duration-200 ${
                          isSelected
                            ? `${accent.bg} ring-2 ${accent.ring} shadow-lg border ${accent.border}`
                            : `${colors.card} border ${colors.cardBorder} ${colors.cardHover} hover:shadow-md`
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 flex-1 min-w-0">
                            <div className={`flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 transition-colors ${
                              isSelected ? accent.bg : colors.cardSecondary
                            }`}>
                              <FileText size={15} className={isSelected ? accent.text : colors.textMuted} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={`font-semibold text-sm ${isSelected ? accent.text : colors.text} truncate block leading-tight`}>
                                {parsed.name || file.fileName.replace('.md', '')}
                              </span>
                              {parsed.description && (
                                <span className={`text-xs ${colors.textMuted} truncate block mt-0.5 leading-tight`}>{parsed.description}</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDelete(file) }}
                            className="cursor-pointer opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/20 flex-shrink-0 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500/60"
                            title={t('common.delete')}
                          >
                            <Trash2 size={14} className="text-red-500" />
                          </button>
                        </div>
                        <div className={`flex items-center gap-2 text-xs ${colors.textMuted} mt-2 ml-9.5 flex-wrap`} style={{ marginLeft: '2.375rem' }}>
                          <ScopeBadge scope={file.scope} accent={accent} />
                          <span className={`px-1.5 py-0.5 rounded ${colors.cardSecondary} text-[10px] font-medium`}>
                            {formatSize(file.size)}
                          </span>
                          {parsed.filePattern && (
                            <code className={`px-1.5 py-0.5 rounded ${accent.bgSoft} border ${accent.borderSoft} font-mono text-[10px] ${accent.textSoft} truncate max-w-[120px]`}>
                              {parsed.filePattern}
                            </code>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// 编辑器组件
function Editor({ file, editState, hasChanges, saving, refining, inclusionOptions, onContentChange, onInclusionChange, onFilePatternChange, onNameChange, onDescriptionChange, onSave, onRefine, surface, accent, colors, t }) {
  const accentSolidButtonClass = getSolidAccentButton(accent)
  return (
    <>
      <div className={`p-4 border-b ${colors.cardBorder} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <h3 className={`font-semibold ${colors.text}`}>{file.fileName}</h3>
          <ScopeBadge scope={file.scope} accent={accent} />
          {hasChanges && <span className="text-xs text-orange-500">● {t('steering.save')}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefine}
            disabled={refining}
            className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 ${accent.ring} ${colors.cardSecondary} disabled:opacity-50`}
          >
            <Wand2 size={14} />
            {refining ? t('steering.refining') : t('steering.refine')}
          </button>
          <button
            onClick={onSave}
            disabled={!hasChanges || saving}
            className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 ${accent.ring} ${
              hasChanges ? accentSolidButtonClass : colors.btnDisabled
            } disabled:opacity-50`}
          >
            <Save size={14} />
            {saving ? t('steering.saving') : t('steering.save')}
          </button>
        </div>
      </div>
      {/* frontmatter 编辑区 */}
      <div className={`px-4 py-3 border-b ${colors.cardBorder} space-y-2`}>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`text-xs ${colors.textMuted}`}>{t('steering.inclusionMode')}:</span>
            <Select
              value={editState.inclusion}
              onChange={onInclusionChange}
              data={inclusionOptions.map(opt => ({ value: opt.value, label: opt.label }))}
              size="xs"
              classNames={{
                input: `${colors.text} ${colors.input} ${colors.inputFocus}`,
                dropdown: `${colors.card} border ${colors.cardBorder}`,
                option: `${colors.text}`
              }}
              styles={{ input: { minWidth: '120px', borderRadius: '0.5rem' } }}
            />
          </div>
          {editState.inclusion === 'fileMatch' && (
            <div className="flex items-center gap-2">
              <span className={`text-xs ${colors.textMuted}`}>{t('steering.filePattern')}:</span>
              <TextInput
                value={editState.filePattern}
                onChange={(e) => onFilePatternChange(e.target.value)}
                placeholder="**/*.jsx"
                size="xs"
                classNames={{
                  input: `${colors.text} ${colors.input} ${colors.inputFocus}`
                }}
                styles={{ input: { width: '128px', borderRadius: '0.5rem' } }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`text-xs ${colors.textMuted}`}>{t('steering.fmName')}:</span>
            <TextInput
              value={editState.name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t('steering.fmNamePlaceholder')}
              size="xs"
              classNames={{
                input: `${colors.text} ${colors.input} ${colors.inputFocus}`
              }}
              styles={{ input: { width: '140px', borderRadius: '0.5rem' } }}
            />
          </div>
          <div className="flex items-center gap-2 flex-1">
            <span className={`text-xs ${colors.textMuted}`}>{t('steering.fmDescription')}:</span>
            <TextInput
              value={editState.description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder={t('steering.fmDescriptionPlaceholder')}
              size="xs"
              classNames={{
                input: `${colors.text} ${colors.input} ${colors.inputFocus}`
              }}
              styles={{ input: { flex: 1, minWidth: '200px', borderRadius: '0.5rem' } }}
            />
          </div>
        </div>
      </div>
      <div className="flex-1 p-4 overflow-hidden">
        <Textarea
          value={editState.content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder={t('steering.contentPlaceholder')}
          classNames={{
            input: `${colors.inputFocus}`
          }}
          styles={{
            root: { height: '100%', display: 'flex', flexDirection: 'column' },
            wrapper: { flex: 1, display: 'flex' },
            input: {
              flex: 1,
              height: '100%',
              minHeight: '400px',
              padding: '1rem',
              borderRadius: '0.75rem',
              fontSize: '0.875rem',
              lineHeight: '1.5',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              resize: 'none',
              color: surface.editorText,
              backgroundColor: surface.editorBg,
              borderColor: surface.editorBorder,
            }
          }}
        />
      </div>
    </>
  )
}

// 创建弹窗组件
function CreateModal({ inclusionOptions, onCreate, onClose, accent, colors, t, hasProjectDir }) {
  const accentGradientButtonClass = getGradientAccentButton(accent)
  const [fileName, setFileName] = useState('')
  const [inclusion, setInclusion] = useState('always')
  const [filePattern, setFilePattern] = useState('')
  const [scope, setScope] = useState('user')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className={`${colors.card} rounded-2xl w-full max-w-[380px] shadow-2xl border ${colors.cardBorder} overflow-hidden`}
        onClick={e => e.stopPropagation()}
        style={{ animation: 'dialogIn 0.2s ease-out' }}
      >
        <div className={`flex items-center justify-between px-5 py-4 ${colors.dialogHeader}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${colors.info} flex items-center justify-center`}>
              <FileText size={20} className={accent.text} />
            </div>
            <h2 className={`text-base font-semibold ${colors.text}`}>{t('steering.newSteering')}</h2>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg transition-colors ${colors.cardHover}`}>
            <X size={18} className={colors.textMuted} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={`block text-xs font-medium ${colors.textMuted} mb-1.5`}>{t('steering.fileName')}</label>
            <TextInput
              placeholder={t('steering.fileNamePlaceholder')}
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              size="md"
              classNames={{
                input: `${colors.text} ${colors.input} ${colors.inputFocus}`
              }}
              styles={{ input: { borderRadius: '0.5rem' } }}
            />
            <p className={`text-xs ${colors.textMuted} mt-1`}>{t('steering.fileNameHint')}</p>
          </div>

          <div>
            <label className={`block text-xs font-medium ${colors.textMuted} mb-1.5`}>{t('steering.fmName')}</label>
            <TextInput
              placeholder={t('steering.fmNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              size="md"
              classNames={{
                input: `${colors.text} ${colors.input} ${colors.inputFocus}`
              }}
              styles={{ input: { borderRadius: '0.5rem' } }}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium ${colors.textMuted} mb-1.5`}>{t('steering.fmDescription')}</label>
            <TextInput
              placeholder={t('steering.fmDescriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              size="md"
              classNames={{
                input: `${colors.text} ${colors.input} ${colors.inputFocus}`
              }}
              styles={{ input: { borderRadius: '0.5rem' } }}
            />
          </div>

          {hasProjectDir && (
            <div>
              <label className={`block text-xs font-medium ${colors.textMuted} mb-1.5`}>{t('kiroConfig.scope')}</label>
              <Select
                value={scope}
                onChange={setScope}
                data={[
                  { value: 'user', label: t('kiroConfig.scopeUser') },
                  { value: 'project', label: t('kiroConfig.scopeProject') },
                ]}
                size="md"
                classNames={{
                  input: `${colors.text} ${colors.input} ${colors.inputFocus}`,
                  dropdown: `${colors.card} border ${colors.cardBorder}`,
                  option: `${colors.text}`
                }}
                styles={{ input: { borderRadius: '0.5rem' } }}
              />
            </div>
          )}

          <div>
            <label className={`block text-xs font-medium ${colors.textMuted} mb-1.5`}>{t('steering.inclusionMode')}</label>
            <Select
              value={inclusion}
              onChange={setInclusion}
              data={inclusionOptions.map(opt => ({
                value: opt.value,
                label: `${opt.label} - ${opt.desc}`
              }))}
              size="md"
              classNames={{
                input: `${colors.text} ${colors.input} ${colors.inputFocus}`,
                dropdown: `${colors.card} border ${colors.cardBorder}`,
                option: `${colors.text}`
              }}
              styles={{ input: { borderRadius: '0.5rem' } }}
            />
          </div>

          {inclusion === 'fileMatch' && (
            <div>
              <label className={`block text-xs font-medium ${colors.textMuted} mb-1.5`}>{t('steering.filePattern')}</label>
              <TextInput
                placeholder={t('steering.filePatternPlaceholder')}
                value={filePattern}
                onChange={(e) => setFilePattern(e.target.value)}
                size="md"
                classNames={{
                  input: `${colors.text} ${colors.input} ${colors.inputFocus}`
                }}
                styles={{ input: { borderRadius: '0.5rem' } }}
              />
            </div>
          )}

          <button
            onClick={() => onCreate(fileName, inclusion, filePattern, scope, name.trim(), description.trim())}
            disabled={!fileName.trim()}
            className={`w-full px-4 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${accentGradientButtonClass}`}
          >
            {t('common.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SteeringPanel
