import { Eye, FilePlus2, Search, Trash2, UploadCloud, X, Send, Stamp, CheckCircle2, FileText, Clock3, Hash, FolderOpen, Download, Pencil, BadgeCheck, Mail, Bell, ClipboardList, UserCheck, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useMemo, type FormEvent } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../contexts/AuthContext'
import { useNotifier } from '../contexts/useNotifier'
import { EmptyState } from '../components/EmptyState'
import { ListFileDoc } from '../components/ListFileDoc'
import { DataViewToggle, type DataViewMode } from '../components/DataViewToggle'
import { CustomSelect } from '../components/CustomSelect'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { AssigneeOption, DocumentRow } from '../types'

const documentTypeLabels: Record<string, string> = {
  totrinh: 'Tờ Trình',
  quyetdinh: 'Quyết Định',
  khenthuong: 'Khen Thưởng',
  baocao: 'Báo Cáo',
  kehoach: 'Kế Hoạch',
  xacnhan: 'Xác Nhận',
  congvan: 'Công Văn',
  thongbao: 'Thông Báo',
  bienbanhop: 'Biên Bản Họp',
}

const labels: Record<string, string> = {
  ...documentTypeLabels,
  chuabanhanh: 'Chưa Ban Hành',
  banhanh: 'Ban Hành',
}

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const assigneeLabel = (option: AssigneeOption) => option.full_name ? `${option.full_name} (${option.email})` : option.email
const backendUrl = import.meta.env.VITE_BACKEND_URL

const parseAssigneeNames = (value: string | null): AssigneeOption[] => {
  if (!value) return []
  return value.split(',').map(item => item.trim()).filter(Boolean).map((item) => {
    const match = item.match(/^(.*)\s+\(([^)]+)\)$/)
    if (match) return { full_name: match[1].trim(), email: match[2].trim() }
    return { full_name: null, email: item }
  })
}

function AssigneeCell({ value }: { value: string | null }) {
  const assignees = parseAssigneeNames(value)
  if (!assignees.length) return <span className="muted-cell">Chưa gán</span>

  return (
    <div className="assignee-cell-list">
      {assignees.map((assignee) => (
        <span className="assignee-cell-item" key={assignee.email} title={assigneeLabel(assignee)}>
          <b>{assignee.full_name || assignee.email}</b>
          {assignee.full_name && <small>{assignee.email}</small>}
        </span>
      ))}
    </div>
  )
}

const documentContent = (document: DocumentRow) => document.description || document.title
const statusLabels: Partial<Record<DocumentRow['status'], string>> = {
  issued: 'Đã Ban Hành',
  pending_issue: 'Chưa Ban Hành',
  archived: 'Chưa Ban Hành',
}

const documentStatusLabel = (document: DocumentRow) => statusLabels[document.status] || 'Chưa Ban Hành'
const matchesFilter = (document: DocumentRow, filter: string) => {
  if (!filter) return true
  if (filter === 'banhanh') return document.status === 'issued'
  if (filter === 'chuabanhanh') return document.status !== 'issued'
  return document.type === filter
}

const countForFilter = (documents: DocumentRow[], filter: string) => documents.filter(document => matchesFilter(document, filter)).length

const readFileBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error(`Không đọc được file "${file.name}".`))
  reader.onload = () => {
    const result = String(reader.result || '')
    resolve(result.includes(',') ? result.split(',')[1] : result)
  }
  reader.readAsDataURL(file)
})

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName || 'download'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

function base64ToBlob(contentBase64: string, mimeType: string) {
  const binary = atob(contentBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
}

type FilePreview = {
  name: string
  mimeType: string
  url: string | null
  docxBuffer: ArrayBuffer | null
  docText: string | null
  message: string | null
}

function extractDocTextFallback(uint8: Uint8Array): string {
  try {
    const decoder16 = new TextDecoder('utf-16le', { fatal: false })
    const full16 = decoder16.decode(uint8)
    const cleanChunks: string[] = []
    const rawLines = full16.split(/[\r\n]+/)
    for (const line of rawLines) {
      const cleaned = line.replace(/[^\x20-\x7E\u00A0-\u024F\u1EA0-\u1EF9]/g, ' ').replace(/\s+/g, ' ').trim()
      if (cleaned.length >= 8 && !cleaned.includes('Microsoft Word') && !cleaned.startsWith('Root Entry')) {
        cleanChunks.push(cleaned)
      }
    }
    if (cleanChunks.length > 0) {
      return cleanChunks.join('\n\n')
    }

    const decoder8 = new TextDecoder('windows-1252', { fatal: false })
    const full8 = decoder8.decode(uint8)
    const raw8 = full8.split(/[\r\n]+/)
    for (const line of raw8) {
      const cleaned = line.replace(/[^\x20-\x7E\u00A0-\u024F\u1EA0-\u1EF9]/g, ' ').replace(/\s+/g, ' ').trim()
      if (cleaned.length >= 10 && !cleaned.startsWith('Root Entry')) {
        cleanChunks.push(cleaned)
      }
    }
    return cleanChunks.join('\n\n')
  } catch (err) {
    console.warn('extractDocTextFallback error:', err)
    return ''
  }
}

function DocFilePreview({ name, text }: { name: string; text: string }) {
  const wordCount = useMemo(() => {
    const trimmed = text.trim()
    return trimmed ? trimmed.split(/\s+/).length : 0
  }, [text])

  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${name}</title>
          <style>
            body { font-family: 'Times New Roman', serif; font-size: 13pt; line-height: 1.6; padding: 40px; color: #111; }
            pre { white-space: pre-wrap; font-family: inherit; }
          </style>
        </head>
        <body>
          <pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  return (
    <div className="doc-file-preview">
      <div className="doc-preview-toolbar">
        <div className="doc-preview-info">
          <span>{name}</span>
          <span style={{ opacity: 0.7, fontSize: '0.75rem' }}>({wordCount} từ)</span>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            color: '#fff',
            borderRadius: '4px',
            padding: '3px 10px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          In nội dung
        </button>
      </div>
      <div className="doc-preview-sheet">
        {text ? (
          <div>{text}</div>
        ) : (
          <div className="doc-preview-empty">
            Không tìm thấy nội dung văn bản trong tệp .doc này. Bạn có thể tải file về để mở bằng Microsoft Word.
          </div>
        )}
      </div>
    </div>
  )
}

function DocxFilePreview({ data }: { data: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rendering, setRendering] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.replaceChildren()
    setRendering(true)
    setError('')
    let cancelled = false

    void import('docx-preview').then(({ renderAsync }) => {
      if (cancelled) return
      return renderAsync(data, container, undefined, {
        className: 'docx-preview-page',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        useBase64URL: true,
      })
    }).then(() => {
      if (!cancelled) setRendering(false)
    }).catch((renderError) => {
      if (cancelled) return
      console.error('Không thể hiển thị file DOCX:', renderError)
      setRendering(false)
      setError('Không thể hiển thị file DOCX. Bạn có thể tải file về để mở.')
    })

    return () => { cancelled = true }
  }, [data])

  return (
    <div className="docx-file-preview">
      {rendering && <div className="file-preview-status">Đang dựng nội dung file...</div>}
      {error && <div className="file-preview-status">{error}</div>}
      <div ref={containerRef} />
    </div>
  )
}

function PaginationBar({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: {
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  if (totalItems === 0) return null

  const startItem = (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalItems)

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    const pages: (number | string)[] = [1]
    if (currentPage > 3) pages.push('...')
    const start = Math.max(2, currentPage - 1)
    const end = Math.min(totalPages - 1, currentPage + 1)
    for (let i = start; i <= end; i++) {
      pages.push(i)
    }
    if (currentPage < totalPages - 2) pages.push('...')
    pages.push(totalPages)
    return pages
  }

  return (
    <div className="table-pagination-container">
      <div className="pagination-info">
        Hiển thị <b>{startItem}</b> - <b>{endItem}</b> trên tổng số <b>{totalItems}</b> hồ sơ
      </div>
      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            type="button"
            className="pagination-btn pagination-nav-btn"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            title="Trang trước"
            aria-label="Trang trước"
          >
            <ChevronLeft size={16} />
            <span className="pagination-text">Trước</span>
          </button>

          <div className="pagination-pages">
            {getPageNumbers().map((page, idx) => {
              if (page === '...') {
                return <span key={`ellipsis-${idx}`} className="pagination-ellipsis">...</span>
              }
              const pageNum = Number(page)
              const isActive = pageNum === currentPage
              return (
                <button
                  key={pageNum}
                  type="button"
                  className={`pagination-btn pagination-page-btn${isActive ? ' is-active' : ''}`}
                  onClick={() => onPageChange(pageNum)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {pageNum}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            className="pagination-btn pagination-nav-btn"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            title="Trang sau"
            aria-label="Trang sau"
          >
            <span className="pagination-text">Sau</span>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

function FileDropzone({ label, files, onChange, accept, validateFile }: { label: string; files: File[]; onChange: (files: File[]) => void; accept: string; validateFile: (file: File) => boolean }) {
  const [dragging, setDragging] = useState(false)
  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    onChange([...files, ...Array.from(list).filter(validateFile)])
  }

  return (
    <label className={dragging ? 'dropzone dragging' : 'dropzone'} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }}>
      <span>{label}</span>
      <input type="file" multiple accept={accept} onChange={(event) => addFiles(event.target.files)} />
      <div>
        <UploadCloud />
        <b>Kéo và thả tệp vào đây hoặc <span className="browse-link">[Browse files]</span></b>
        <small>{files.length ? files.map((file) => file.name).join(', ') : ''}</small>
      </div>
      {files.length > 0 && <button type="button" className="clear-files" onClick={(event) => { event.preventDefault(); onChange([]) }}><X />Xóa file</button>}
    </label>
  )
}

function AssigneeCombobox({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: AssigneeOption[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(opt => {
      const emailMatch = opt.email.toLowerCase().includes(q)
      const nameMatch = (opt.full_name || '').toLowerCase().includes(q)
      return emailMatch || nameMatch
    })
  }, [options, query])

  const handleSelect = (val: string) => {
    onChange(val)
    setQuery(val)
    setOpen(false)
  }

  const handleInputChange = (text: string) => {
    setQuery(text)
    onChange(text)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setQuery('')
    onChange('')
    setOpen(false)
  }

  return (
    <div className="assignee-combobox-root" ref={rootRef}>
      <div
        className={`assignee-combobox-control ${open ? 'is-focused' : ''}`}
        onClick={() => setOpen(true)}
      >
        <UserCheck className="combobox-lead-icon" size={17} />
        <input
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Tìm người thực hiện (tên, email)..."
          className="combobox-search-input"
        />
        {query && (
          <button
            type="button"
            className="combobox-clear-btn"
            onClick={handleClear}
            title="Xóa tìm kiếm"
          >
            <X size={15} />
          </button>
        )}
        <button
          type="button"
          className="combobox-toggle-btn"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(o => !o)
          }}
          title="Danh sách người thực hiện"
        >
          <ChevronDown size={15} />
        </button>
      </div>

      {open && (
        <div className="assignee-combobox-menu">
          <button
            type="button"
            className={`combobox-option-item ${!value ? 'is-active' : ''}`}
            onClick={() => handleSelect('')}
          >
            <span className="option-name">Tất cả người thực hiện</span>
            {!value && <Check size={14} className="option-check" />}
          </button>
          <button
            type="button"
            className={`combobox-option-item ${value === 'Chưa gán' ? 'is-active' : ''}`}
            onClick={() => handleSelect('Chưa gán')}
          >
            <span className="option-name">Chưa gán người thực hiện</span>
            {value === 'Chưa gán' && <Check size={14} className="option-check" />}
          </button>

          {filtered.length > 0 && <div className="combobox-menu-divider" />}

          <div className="combobox-option-scroll">
            {filtered.map(opt => {
              const isSelected = value.toLowerCase() === opt.email.toLowerCase() || (Boolean(opt.full_name) && value.toLowerCase() === opt.full_name?.toLowerCase())
              return (
                <button
                  type="button"
                  key={opt.email}
                  className={`combobox-option-item ${isSelected ? 'is-active' : ''}`}
                  onClick={() => handleSelect(opt.email)}
                >
                  <div className="option-text">
                    <span className="option-name">{opt.full_name || opt.email}</span>
                    <span className="option-email">{opt.email}</span>
                  </div>
                  {isSelected && <Check size={14} className="option-check" />}
                </button>
              )
            })}
          </div>

          {filtered.length === 0 && (
            <div className="combobox-menu-empty">
              Không tìm thấy người thực hiện theo "{query}".
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function DocumentsPage() {
  const { user, profile } = useAuth()
  const { notify, confirmAction } = useNotifier()
  const [allDocs, setAllDocs] = useState<DocumentRow[]>([])
  const [search, setSearch] = useState('')
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [show, setShow] = useState(false)
  const [editingDoc, setEditingDoc] = useState<DocumentRow | null>(null)
  const [error, setError] = useState('')
  const [assigneeInput, setAssigneeInput] = useState('')
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([])
  const [selectedAssignees, setSelectedAssignees] = useState<AssigneeOption[]>([])
  const [inviteMessage, setInviteMessage] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [issuedAttachments, setIssuedAttachments] = useState<File[]>([])
  const [fileRefreshKey, setFileRefreshKey] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [savingDocument, setSavingDocument] = useState(false)
  const [viewMode, setViewMode] = useState<DataViewMode>('table')
  const forceGrid = useMediaQuery('(max-width: 760px)')

  const [selectedDoc, setSelectedDoc] = useState<DocumentRow | null>(null)
  const [docFiles, setDocFiles] = useState<{ id: string; name: string; object_path: string | null; file_kind: string }[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Helper function to check if current user is in assignee list
  const isUserAssignee = useCallback((doc: DocumentRow): boolean => {
    if (!user) return false
    if (!doc.assignee_name) return false
    const assignees = parseAssigneeNames(doc.assignee_name)
    return assignees.some(a => a.email.toLowerCase() === user.email?.toLowerCase())
  }, [user])


  async function uploadFiles(documentId: string, files: File[], fileKind: 'attachment' | 'issued_attachment') {
    if (!files.length) return

    for (const file of files) {
      await callBackend('/api/upload-document-file', {
        documentId,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        fileKind,
        contentBase64: await readFileBase64(file),
      })
    }
  }

  async function removeExistingFile(fileId: string) {
    if (!editingDoc) return
    const confirmed = await confirmAction({
      title: 'Xóa file khỏi hồ sơ?',
      message: 'File sẽ bị xóa khỏi hồ sơ hiện tại.',
      confirmText: 'Xóa file',
      danger: true,
    })
    if (!confirmed) return
    try {
      await callBackend('/api/delete-document-file', { fileId })
      notify('Đã xóa file khỏi hồ sơ.', 'success')
      setFileRefreshKey((key) => key + 1)
      if (selectedDoc) void handleViewDetail(selectedDoc)
    } catch (error) {
      if (emitSessionExpired(error)) return
      const message = error instanceof Error ? error.message : 'Không thể xóa file.'
      setError(message)
      notify(message, 'error')
    }
  }

  async function downloadDocumentFile(fileId: string) {
    const payload = await callBackend<{
      ok: boolean
      name: string
      mimeType: string
      contentBase64: string
    }>('/api/download-document-file', { fileId })

    const blob = base64ToBlob(payload.contentBase64, payload.mimeType)
    if (blob.size === 0) throw new Error('File tải về đang rỗng.')
    downloadBlob(blob, payload.name)
  }

  async function previewDocumentFile(fileId: string) {
    setLoadingPreview(true)
    try {
      const payload = await callBackend<{
        ok: boolean
        name: string
        mimeType: string
        contentBase64: string
        docText?: string
      }>('/api/download-document-file', { fileId })

      const blob = base64ToBlob(payload.contentBase64, payload.mimeType)
      if (blob.size === 0) throw new Error('File xem trước đang rỗng.')

      const arrayBuffer = await blob.arrayBuffer()
      const uint8 = new Uint8Array(arrayBuffer)
      const isZipDocx = uint8.length >= 4 && uint8[0] === 0x50 && uint8[1] === 0x4B // 'PK'

      if (/\.docx$/i.test(payload.name) || (/\.doc$/i.test(payload.name) && isZipDocx)) {
        setFilePreview(current => {
          if (current?.url) URL.revokeObjectURL(current.url)
          return { name: payload.name, mimeType: payload.mimeType, url: null, docxBuffer: arrayBuffer, docText: null, message: null }
        })
        return
      }

      if (/\.doc$/i.test(payload.name)) {
        let extractedText = payload.docText || ''
        if (!extractedText) {
          extractedText = extractDocTextFallback(uint8)
        }

        setFilePreview(current => {
          if (current?.url) URL.revokeObjectURL(current.url)
          return {
            name: payload.name,
            mimeType: payload.mimeType,
            url: null,
            docxBuffer: null,
            docText: extractedText || 'Không tìm thấy nội dung văn bản trong tệp .doc này. Bạn có thể tải file về để mở bằng Microsoft Word.',
            message: null,
          }
        })
        return
      }

      const objectUrl = URL.createObjectURL(blob)
      setFilePreview(current => {
        if (current?.url) URL.revokeObjectURL(current.url)
        return { name: payload.name, mimeType: payload.mimeType, url: objectUrl, docxBuffer: null, docText: null, message: null }
      })
    } catch (error) {
      if (emitSessionExpired(error)) return
      notify(error instanceof Error ? error.message : 'Không xem được file.', 'error')
    } finally {
      setLoadingPreview(false)
    }
  }

  function closeFilePreview() {
    setFilePreview(current => {
      if (current?.url) URL.revokeObjectURL(current.url)
      return null
    })
  }

  useEffect(() => () => {
    if (filePreview?.url) URL.revokeObjectURL(filePreview.url)
  }, [filePreview?.url])

  const resetCreateForm = () => {
    setAssigneeInput('')
    setAssigneeOptions([])
    setSelectedAssignees(user ? [{ id: user.id, email: user.email || profile?.email || '', full_name: profile?.full_name || null }] : [])
    setInviteMessage('')
    setAttachments([])
    setIssuedAttachments([])
    setEditingDoc(null)
  }

  async function callBackend<T = { ok: boolean }>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!backendUrl) throw new Error('Thiếu VITE_BACKEND_URL trong .env.')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Phiên đăng nhập không hợp lệ.')

    const response = await fetch(`${backendUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })

    const payload = await response.json().catch(() => ({})) as T & { error?: string }
    if (!response.ok) {
      const message = payload.error || 'Backend xử lý thất bại.'
      if (response.status === 401) emitSessionExpired(message)
      throw new Error(message)
    }
    return payload
  }

  const load = useCallback(async () => {
    let query = supabase
      .from('documents')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })

    const { data, error } = await query
    if (error) {
      if (emitSessionExpired(error)) return
      setError(error.message)
    }
    else setAllDocs((data || []) as DocumentRow[])
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel(`documents:${user?.id ?? 'anonymous'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_shares' }, () => { void load() })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load, user?.id])

  const isAdmin = profile?.role === 'admin'

  const filteredItems = useMemo(() => {
    return allDocs.filter(doc => {
      const matchesType = matchesFilter(doc, typeFilter)
      const docYear = doc.document_year || new Date(doc.created_at).getFullYear()
      const matchesYear = !yearFilter || docYear === Number(yearFilter)
      const matchesSearch = !search ||
        doc.title.toLowerCase().includes(search.toLowerCase()) ||
        (doc.description && doc.description.toLowerCase().includes(search.toLowerCase())) ||
        (doc.assignee_name && doc.assignee_name.toLowerCase().includes(search.toLowerCase()))

      const assigneeDisplay = doc.assignee_name || 'Chưa gán'
      const matchesAssignee = !assigneeSearch.trim() ||
        assigneeDisplay.toLowerCase().includes(assigneeSearch.trim().toLowerCase())

      // Kiểm tra quyền xem: admin, người tạo, hoặc người có trong danh sách người thực hiện
      const canView = isAdmin || doc.created_by === user?.id || isUserAssignee(doc)

      return matchesType && matchesYear && matchesSearch && matchesAssignee && canView
    })
  }, [allDocs, typeFilter, yearFilter, search, assigneeSearch, isAdmin, user?.id, isUserAssignee])

  const availableYears = useMemo(() => {
    const years = new Set(allDocs.map(doc => doc.document_year || new Date(doc.created_at).getFullYear()))
    years.add(new Date().getFullYear())
    return Array.from(years).sort((a, b) => b - a)
  }, [allDocs])

  const allAssigneeOptions = useMemo(() => {
    const map = new Map<string, AssigneeOption>()
    for (const doc of allDocs) {
      if (!doc.assignee_name) continue
      const list = parseAssigneeNames(doc.assignee_name)
      for (const a of list) {
        if (!map.has(a.email.toLowerCase())) {
          map.set(a.email.toLowerCase(), a)
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
  }, [allDocs])

  const PAGE_SIZE = 10
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    setCurrentPage(1)
  }, [typeFilter, yearFilter, search, assigneeSearch])

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages)

  const paginatedItems = useMemo(() => {
    const startIndex = (validCurrentPage - 1) * PAGE_SIZE
    return filteredItems.slice(startIndex, startIndex + PAGE_SIZE)
  }, [filteredItems, validCurrentPage])

  const deletableFilteredItems = useMemo(() => {
    return filteredItems.filter((document) => isAdmin || document.created_by === user?.id)
  }, [filteredItems, isAdmin, user?.id])

  const deletablePageItems = useMemo(() => {
    return paginatedItems.filter((document) => isAdmin || document.created_by === user?.id)
  }, [paginatedItems, isAdmin, user?.id])

  const selectedDeletableItems = useMemo(() => {
    return deletableFilteredItems.filter((document) => selectedIds.has(document.id))
  }, [deletableFilteredItems, selectedIds])

  const allDeletableSelected = deletablePageItems.length > 0 && deletablePageItems.every(doc => selectedIds.has(doc.id))

  useEffect(() => {
    setSelectedIds((current) => {
      const existingIds = new Set(allDocs.map((document) => document.id))
      const next = new Set([...current].filter((id) => existingIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [allDocs])

  const typeCounts = useMemo(() => {
    return Object.fromEntries(Object.keys(labels).map(key => [key, countForFilter(allDocs, key)]))
  }, [allDocs])

  function exportExcelFile() {
    const rows = filteredItems.map(document => ({
      'Loại': documentTypeLabels[document.type] || document.type,
      'Nội dung': documentContent(document),
      'Người thực hiện': document.assignee_name || 'Chưa gán',
      'Năm': document.document_year || new Date(document.created_at).getFullYear(),
    }))
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: ['Loại', 'Nội dung', 'Người thực hiện', 'Năm'] })
    worksheet['!cols'] = [{ wch: 18 }, { wch: 80 }, { wch: 42 }, { wch: 12 }]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ho so')
    XLSX.writeFile(workbook, `ho-so-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const isWordFile = (file: File) => /\.(doc|docx)$/i.test(file.name)
  const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf'

  async function hasExistingIssuedFile(documentId: string) {
    const { count, error } = await supabase
      .from('document_files')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .eq('file_kind', 'issued_attachment')
      .is('deleted_at', null)

    if (error) throw error
    return Boolean(count && count > 0)
  }

  async function handleViewDetail(doc: DocumentRow) {
    setSelectedDoc(doc)
    setLoadingFiles(true)
    setDocFiles([])
    try {
      const { data, error } = await supabase
        .from('document_files')
        .select('id, name, object_path, file_kind')
        .eq('document_id', doc.id)
        .is('deleted_at', null)
      if (error) throw error
      setDocFiles((data || []) as { id: string; name: string; object_path: string | null; file_kind: string }[])
    } catch (err) {
      if (emitSessionExpired(err)) return
      console.error('Lỗi khi tải file đính kèm:', err)
    } finally {
      setLoadingFiles(false)
    }
  }

  useEffect(() => {
    if (!selectedDoc) return

    const loadSelectedDocFiles = async () => {
      setLoadingFiles(true)
      try {
        const { data, error } = await supabase
          .from('document_files')
          .select('id, name, object_path, file_kind')
          .eq('document_id', selectedDoc.id)
          .is('deleted_at', null)
        if (error) throw error
        setDocFiles((data || []) as { id: string; name: string; object_path: string | null; file_kind: string }[])
      } catch (err) {
        if (emitSessionExpired(err)) return
        console.error('Lỗi khi tải file đính kèm:', err)
      } finally {
        setLoadingFiles(false)
      }
    }

    const channel = supabase
      .channel(`document-detail-files:${selectedDoc.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'document_files',
        filter: `document_id=eq.${selectedDoc.id}`,
      }, () => { void loadSelectedDocFiles() })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [selectedDoc])


  useEffect(() => {
    if (!show || assigneeInput.trim().length < 2) {
      setAssigneeOptions([])
      return
    }

    const timer = window.setTimeout(async () => {
      const { data } = await supabase.rpc('search_assignees', { p_query: assigneeInput.trim() })
      const opts = (data || []) as AssigneeOption[]
      // Lọc bỏ những người đã được chọn
      setAssigneeOptions(opts.filter(opt => !selectedAssignees.some(s => s.email === opt.email)))
    }, 250)

    return () => window.clearTimeout(timer)
  }, [assigneeInput, selectedAssignees, show])

  const handleAddAssignee = (option: AssigneeOption) => {
    if (selectedAssignees.some(a => a.email.toLowerCase() === option.email.toLowerCase())) {
      return
    }
    setSelectedAssignees([...selectedAssignees, option])
    setAssigneeInput('')
    setAssigneeOptions([])
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const val = assigneeInput.trim()
      if (!val) return

      const exactMatch = assigneeOptions.find(
        opt => opt.email.toLowerCase() === val.toLowerCase() || opt.full_name?.toLowerCase() === val.toLowerCase()
      )
      if (exactMatch) {
        handleAddAssignee(exactMatch)
        return
      }

      if (isEmail(val)) {
        handleAddAssignee({ email: val.toLowerCase(), full_name: null })
      } else {
        setInviteMessage('Vui lòng nhập email hợp lệ để thêm người thực hiện mới.')
      }
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    setSavingDocument(true)

    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const content = String(form.get('content') || '').trim()
    const documentType = String(form.get('type') || 'totrinh')
    const yearValue = Number(form.get('document_year') || new Date().getFullYear())

    // Ghép tên/email của toàn bộ danh sách thành một chuỗi phân tách bằng dấu phẩy
    const assigneeNames = selectedAssignees
      .map(a => a.full_name ? `${a.full_name} (${a.email})` : a.email)
      .join(', ')

    // Đặt assignee_id của documents là ID của người thực hiện đã đăng ký đầu tiên trong danh sách (nếu có)
    const firstRegistered = selectedAssignees.find(a => !!a.id)
    const primaryAssigneeId = firstRegistered ? firstRegistered.id : null

    try {
      const requestedDocumentId = editingDoc?.id || crypto.randomUUID()
      const hasIssuedFile = issuedAttachments.length > 0 || (editingDoc ? await hasExistingIssuedFile(requestedDocumentId) : false)
      const documentPayload = {
        type: documentType,
        title: content.slice(0, 250),
        description: content,
        assignee_name: assigneeNames || null,
        assignee_id: primaryAssigneeId,
        document_year: yearValue,
        status: hasIssuedFile ? 'issued' : 'pending_issue',
      }

      const { documentId } = await callBackend<{ ok: boolean; documentId: string }>('/api/save-document', {
        documentId: requestedDocumentId,
        editing: Boolean(editingDoc),
        document: documentPayload,
      })

      await uploadFiles(documentId, attachments, 'attachment')
      await uploadFiles(documentId, issuedAttachments, 'issued_attachment')

      // Gọi backend để thiết lập phân quyền (document_shares), in-app notifications, gửi email thông báo/lời mời
      const externalAssignees = selectedAssignees.filter(a => a.id !== user.id)
      await callBackend('/api/setup-document-assignees', {
        documentId,
        assignees: externalAssignees.map(a => ({
          id: a.id,
          email: a.email,
          name: a.full_name
        }))
      })

      notify(editingDoc ? 'Đã cập nhật hồ sơ.' : 'Đã tạo hồ sơ.', 'success')
      setShow(false)
      formElement.reset()
      resetCreateForm()
      void load()
    } catch (error) {
      if (emitSessionExpired(error)) return
      const message = error instanceof Error ? error.message : 'Không thể tạo hồ sơ.'
      setError(message)
      notify(message, 'error')
    } finally {
      setSavingDocument(false)
    }
  }

  function openCreateForm() {
    resetCreateForm()
    setShow(true)
  }

  function openEditForm(document: DocumentRow) {
    setEditingDoc(document)
    setAssigneeInput('')
    setAssigneeOptions([])
    setInviteMessage('')
    setAttachments([])
    setIssuedAttachments([])
    const parsedAssignees = parseAssigneeNames(document.assignee_name)
    setSelectedAssignees(parsedAssignees.length ? parsedAssignees.map((item, index) => ({
      ...item,
      id: index === 0 ? document.assignee_id || undefined : undefined,
    })) : [{ id: user?.id, email: user?.email || profile?.email || '', full_name: profile?.full_name || null }])
    setShow(true)
    setFileRefreshKey((key) => key + 1)
  }



  async function remove(document: DocumentRow) {
    const confirmed = await confirmAction({
      title: 'Xóa hồ sơ?',
      message: `Xóa hồ sơ "${document.title}"? Hồ sơ sẽ được chuyển vào thùng rác.`,
      confirmText: 'Xóa hồ sơ',
      danger: true,
    })
    if (!confirmed) return
    try {
      await callBackend('/api/soft-delete-document', { documentId: document.id })
      notify('Đã chuyển hồ sơ vào thùng rác.', 'success')
      void load()
    } catch (error) {
      if (emitSessionExpired(error)) return
      const message = error instanceof Error ? error.message : 'Không thể xóa hồ sơ.'
      setError(message)
      notify(message, 'error')
    }
  }

  function toggleSelect(documentId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })
  }

  function toggleSelectAllDeletable() {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allDeletableSelected) {
        deletablePageItems.forEach((document) => next.delete(document.id))
      } else {
        deletablePageItems.forEach((document) => next.add(document.id))
      }
      return next
    })
  }

  async function removeSelected() {
    if (!selectedDeletableItems.length) {
      notify('Chọn ít nhất một hồ sơ có quyền xóa.', 'warning')
      return
    }

    const confirmed = await confirmAction({
      title: `Xóa ${selectedDeletableItems.length} hồ sơ?`,
      message: 'Các hồ sơ được chọn sẽ được chuyển vào thùng rác.',
      confirmText: 'Xóa đã chọn',
      danger: true,
    })
    if (!confirmed) return

    try {
      for (const document of selectedDeletableItems) {
        await callBackend('/api/soft-delete-document', { documentId: document.id })
      }
      setSelectedIds((current) => {
        const next = new Set(current)
        selectedDeletableItems.forEach((document) => next.delete(document.id))
        return next
      })
      notify(`Đã chuyển ${selectedDeletableItems.length} hồ sơ vào thùng rác.`, 'success')
      void load()
    } catch (error) {
      if (emitSessionExpired(error)) return
      const message = error instanceof Error ? error.message : 'Không thể xóa các hồ sơ đã chọn.'
      setError(message)
      notify(message, 'error')
    }
  }

  const typeList = [
    { key: 'chuabanhanh', label: 'Chưa Ban Hành', icon: Clock3 },
    { key: 'totrinh', label: 'Tờ Trình', icon: Send },
    { key: 'quyetdinh', label: 'Quyết Định', icon: Stamp },
    { key: 'khenthuong', label: 'Khen Thưởng', icon: CheckCircle2 },
    { key: 'baocao', label: 'Báo Cáo', icon: FileText },
    { key: 'kehoach', label: 'Kế Hoạch', icon: Clock3 },
    { key: 'xacnhan', label: 'Xác Nhận', icon: BadgeCheck },
    { key: 'congvan', label: 'Công Văn', icon: Mail },
    { key: 'thongbao', label: 'Thông Báo', icon: Bell },
    { key: 'bienbanhop', label: 'Biên Bản Họp', icon: ClipboardList },
    { key: 'banhanh', label: 'Ban Hành', icon: Hash },
  ]
  const typeSelectDefault = editingDoc?.type && documentTypeLabels[editingDoc.type]
    ? editingDoc.type
    : typeFilter && documentTypeLabels[typeFilter]
      ? typeFilter
      : 'totrinh'

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Quản lý hồ sơ</h1>
          <p>Tra cứu, tạo mới và theo dõi trạng thái hồ sơ.</p>
        </div>
        <div className="page-heading-actions">
          <button type="button" className="export-excel-button" onClick={exportExcelFile}><Download />Xuất Excel</button>
          <button className="primary" onClick={openCreateForm}><FilePlus2 />Tạo hồ sơ</button>
        </div>
      </div>

      {/* Card Filter Loại Hồ Sơ */}
      <section className="metric-grid documents-metrics-row" style={{ marginBottom: '1.5rem' }}>
        <article
          className={`metric-card clickable ${!typeFilter ? 'active' : ''}`}
          onClick={() => setTypeFilter('')}
          style={{ cursor: 'pointer' }}
        >
          <span className="metric-icon"><FolderOpen /></span>
          <span className="metric-copy">
            <span>Tất cả hồ sơ</span>
            <b>{allDocs.length}</b>
          </span>
        </article>
        {typeList.map(({ key, label, icon: Icon }) => {
          const count = typeCounts[key] ?? 0
          const isActive = typeFilter === key
          return (
            <article
              className={`metric-card clickable${isActive ? ' active' : ''}${count === 0 && !isActive ? ' is-empty' : ''}`}
              key={key}
              onClick={() => setTypeFilter(key)}
              style={{ cursor: 'pointer' }}
            >
              <span className="metric-icon"><Icon /></span>
              <span className="metric-copy">
                <span>{label}</span>
                <b>{count}</b>
              </span>
            </article>
          )
        })}
      </section>

      <section className="toolbar documents-toolbar">
        <label className="toolbar-search-input">
          <Search />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm theo tiêu đề hoặc nội dung..."
          />
          {search && (
            <button
              type="button"
              className="toolbar-clear-btn"
              onClick={() => setSearch('')}
              title="Xóa tìm kiếm nội dung"
            >
              <X size={15} />
            </button>
          )}
        </label>
        <AssigneeCombobox
          value={assigneeSearch}
          onChange={setAssigneeSearch}
          options={allAssigneeOptions}
        />
        {selectedDeletableItems.length > 0 && (
          <button type="button" className="danger-icon text-button bulk-delete-button" onClick={() => void removeSelected()}>
            <Trash2 />
            Xóa {selectedDeletableItems.length} hồ sơ
          </button>
        )}
        <DataViewToggle value={viewMode} onChange={setViewMode} forceGrid={forceGrid} />
        <CustomSelect
          className="year-combobox"
          value={yearFilter}
          onChange={setYearFilter}
          ariaLabel="Lọc theo năm"
          options={[{ value: '', label: 'Tất cả năm' }, ...availableYears.map(year => ({ value: String(year), label: String(year) }))]}
        />
        <span>{filteredItems.length} hồ sơ</span>
      </section>
      {error && <p className="error">{error}</p>}
      <section className={`table-card records-table-card data-view-card ${forceGrid || viewMode === 'grid' ? 'is-grid-view' : 'is-table-view'}`}>
        <table className="records-table documents-table">
          <thead>
            <tr>
              <th className="select-column">
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả hồ sơ có thể xóa"
                  checked={allDeletableSelected}
                  disabled={!deletablePageItems.length}
                  onChange={toggleSelectAllDeletable}
                />
              </th>
              <th className="type-column">Loại</th>
              <th className="content-column">Nội dung</th>
              <th className="assignee-column">Người thực hiện</th>
              <th className="year-column">Năm</th>
              <th className="status-column">Tình trạng</th>
              <th className="action-column">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map((document) => {
              const canEdit = document.created_by === user?.id
              const canDelete = isAdmin || document.created_by === user?.id
              return (
                <tr key={document.id}>
                  <td className="select-column">
                    {canDelete && (
                      <input
                        type="checkbox"
                        aria-label={`Chọn hồ sơ ${document.title}`}
                        checked={selectedIds.has(document.id)}
                        onChange={() => toggleSelect(document.id)}
                      />
                    )}
                  </td>
                  <td className="type-column">{documentTypeLabels[document.type] || document.type}</td>
                  <td className="content-column">
                    <span
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleViewDetail(document)}
                      className="document-summary hover-link"
                    >
                      {documentContent(document)}
                    </span>
                  </td>
                  <td className="assignee-column"><AssigneeCell value={document.assignee_name} /></td>
                  <td className="year-column">{document.document_year || new Date(document.created_at).getFullYear()}</td>
                  <td className="status-column"><span className={`status ${document.status}`}>{documentStatusLabel(document)}</span></td>
                  <td className="action-column">
                    <div className="row-actions record-row-actions document-row-actions">
                      <button className="ghost compact" title="Xem chi tiết" onClick={() => handleViewDetail(document)}>
                        <Eye />
                      </button>
                      {canEdit && (
                        <button className="ghost compact" title="Sửa hồ sơ" onClick={() => openEditForm(document)}>
                          <Pencil />
                        </button>
                      )}
                      {canDelete && (
                        <button className="danger-icon" title="Xóa hồ sơ" onClick={() => remove(document)}>
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!filteredItems.length && <tr><td colSpan={7}><EmptyState message="Chưa có hồ sơ nào." /></td></tr>}
          </tbody>
        </table>
        <div className="data-grid document-data-grid">
          {paginatedItems.map((document) => {
            const canEdit = document.created_by === user?.id
            const canDelete = isAdmin || document.created_by === user?.id
            return (
              <article className="data-card" key={document.id}>
                <div className="data-card-title-row">
                  <span className="status">{documentTypeLabels[document.type] || document.type}</span>
                  {canDelete && (
                    <input
                      type="checkbox"
                      aria-label={`Chọn hồ sơ ${document.title}`}
                      checked={selectedIds.has(document.id)}
                      onChange={() => toggleSelect(document.id)}
                    />
                  )}
                </div>
                <button type="button" className="data-card-main hover-link" onClick={() => handleViewDetail(document)}>
                  {documentContent(document)}
                </button>
                <div className="data-card-meta">
                  <span>Người thực hiện</span>
                  <b>{document.assignee_name || 'Chưa gán'}</b>
                </div>
                <div className="data-card-meta">
                  <span>Năm</span>
                  <b>{document.document_year || new Date(document.created_at).getFullYear()}</b>
                </div>
                <div className="data-card-meta">
                  <span>Tình trạng</span>
                  <b>{documentStatusLabel(document)}</b>
                </div>
                <div className="row-actions record-row-actions document-row-actions data-card-actions">
                  <button className="ghost compact" title="Xem chi tiết" onClick={() => handleViewDetail(document)}>
                    <Eye />
                  </button>
                  {canEdit && (
                    <button className="ghost compact" title="Sửa hồ sơ" onClick={() => openEditForm(document)}>
                      <Pencil />
                    </button>
                  )}
                  {canDelete && (
                    <button className="danger-icon" title="Xóa hồ sơ" onClick={() => remove(document)}>
                      <Trash2 />
                    </button>
                  )}
                </div>
              </article>
            )
          })}
          {!filteredItems.length && <EmptyState message="Chưa có hồ sơ nào." />}
        </div>
        <PaginationBar
          currentPage={validCurrentPage}
          totalPages={totalPages}
          totalItems={filteredItems.length}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => {
            setCurrentPage(page)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      </section>

      {/* Modal Tạo hồ sơ mới */}
      {show && (
        <div className="modal">
          <form className="document-form modal-container-style" onSubmit={create} aria-busy={savingDocument}>
            {savingDocument && (
              <div className="document-saving-overlay" role="status" aria-live="polite">
                <span className="document-saving-spinner" aria-hidden="true" />
                <strong>Đang lưu hồ sơ...</strong>
                <small>Vui lòng chờ trong giây lát</small>
              </div>
            )}
            <div className="modal-form-header">
              <h2>{editingDoc ? 'Sửa hồ sơ' : 'Tạo hồ sơ mới'}</h2>
              <button type="button" className="btn-close" onClick={() => { setShow(false); resetCreateForm() }} disabled={savingDocument}><X /></button>
            </div>
            <div className="modal-form-body">
              <div className="form-top-row">
                <div className="form-left-col">
                  <label className="form-group content-field-custom">
                    Nội dung
                    <textarea name="content" placeholder="Nhập nội dung hồ sơ..." defaultValue={editingDoc?.description || ''} required />
                  </label>
                </div>
                <div className="form-right-col">
                  <label className="form-group" style={{ marginBottom: '12px' }}>
                    Loại hồ sơ
                    <CustomSelect
                      key={typeSelectDefault}
                      name="type"
                      defaultValue={typeSelectDefault}
                      ariaLabel="Loại hồ sơ"
                      options={Object.entries(documentTypeLabels).map(([value, label]) => ({ value, label }))}
                    />
                  </label>
                  <div className="row-flex">
                    <label className="form-group assignee-field-custom">
                      Người thực hiện
                      <div className="assignee-combobox">
                        <input
                          value={assigneeInput}
                          onChange={(event) => { setAssigneeInput(event.target.value); setInviteMessage('') }}
                          onKeyDown={handleKeyDown}
                          placeholder="Chọn hoặc nhập người thực hiện"
                        />
                        {assigneeOptions.length > 0 && (
                          <div className="assignee-options">
                            {assigneeOptions.map((option) => (
                              <button
                                type="button"
                                key={option.id}
                                onClick={() => handleAddAssignee(option)}
                              >
                                {assigneeLabel(option)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {inviteMessage && <small>{inviteMessage}</small>}
                      {selectedAssignees.length > 0 && (
                        <div className="selected-assignees-list">
                          {selectedAssignees.map((assignee) => (
                            <span key={assignee.email} className="assignee-chip">
                              <span title={assignee.full_name ? `${assignee.full_name} (${assignee.email})` : assignee.email}>
                                {assignee.full_name ? `${assignee.full_name} (${assignee.email})` : assignee.email}
                              </span>
                              <button
                                type="button"
                                onClick={() => setSelectedAssignees(selectedAssignees.filter(a => a.email !== assignee.email))}
                              >
                                <X size={14} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </label>
                    <label className="form-group year-field-custom">
                      Năm
                      <input name="document_year" type="number" min={2000} max={2100} defaultValue={editingDoc?.document_year || new Date().getFullYear()} required />
                    </label>
                  </div>
                </div>
              </div>
              <div className="document-file-grid" style={{ marginTop: '24px' }}>
                <div>
                  <FileDropzone label="Văn bản Word" files={attachments} onChange={setAttachments} accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" validateFile={isWordFile} />
                  {editingDoc && <ListFileDoc documentId={editingDoc.id} refreshKey={fileRefreshKey} pendingFiles={attachments.map(file => ({ name: file.name, kind: 'attachment' }))} fileKind="attachment" onRemoveExistingFile={removeExistingFile} downloadFile={downloadDocumentFile} previewFile={previewDocumentFile} />}
                </div>
                <div>
                  <FileDropzone label="Ban Hành PDF" files={issuedAttachments} onChange={setIssuedAttachments} accept=".pdf,application/pdf" validateFile={isPdfFile} />
                  {editingDoc && <ListFileDoc documentId={editingDoc.id} refreshKey={fileRefreshKey} pendingFiles={issuedAttachments.map(file => ({ name: file.name, kind: 'issued_attachment' }))} fileKind="issued_attachment" onRemoveExistingFile={removeExistingFile} downloadFile={downloadDocumentFile} previewFile={previewDocumentFile} />}
                </div>
              </div>
            </div>
            <div className="modal-form-footer">
              <button type="button" className="btn-cancel" onClick={() => { setShow(false); resetCreateForm() }} disabled={savingDocument}>Hủy</button>
              <button className="btn-submit" disabled={savingDocument}>
                {savingDocument ? (
                  <>
                    <span className="spinner"></span> Đang lưu...
                  </>
                ) : 'Lưu hồ sơ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Xem chi tiết hồ sơ */}
      {selectedDoc && (
        <div className="modal">
          <div className="modal-container-style" style={{ maxWidth: '700px', width: '90%' }}>
            <div className="modal-form-header">
              <h2>Chi tiết hồ sơ</h2>
              <button type="button" className="btn-close" onClick={() => setSelectedDoc(null)}><X /></button>
            </div>
            <div className="modal-form-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
                <div>
                  <small style={{ color: 'var(--muted)', display: 'block' }}>Ngày tạo</small>
                  <strong>{new Date(selectedDoc.created_at).toLocaleDateString('vi-VN')}</strong>
                </div>
                <div>
                  <small style={{ color: 'var(--muted)', display: 'block' }}>Loại hồ sơ</small>
                  <strong>{documentTypeLabels[selectedDoc.type] || selectedDoc.type}</strong>
                </div>
                <div>
                  <small style={{ color: 'var(--muted)', display: 'block' }}>Năm tài liệu</small>
                  <strong>{selectedDoc.document_year || new Date(selectedDoc.created_at).getFullYear()}</strong>
                </div>
                <div>
                  <small style={{ color: 'var(--muted)', display: 'block' }}>Tình trạng</small>
                  <strong>{documentStatusLabel(selectedDoc)}</strong>
                </div>
              </div>

              <div style={{ marginBottom: '20px', padding: '12px', background: 'var(--bg-card, #f8fafc)', borderRadius: '6px' }}>
                <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Người thực hiện</small>
                {parseAssigneeNames(selectedDoc.assignee_name).length > 0 ? (
                  <div className="assignee-detail-list">
                    {parseAssigneeNames(selectedDoc.assignee_name).map((assignee) => (
                      <div key={assignee.email}>- {assigneeLabel(assignee)}</div>
                    ))}
                  </div>
                ) : (
                  <strong>Không có người thực hiện cụ thể</strong>
                )}
              </div>

              {selectedDoc.description && (
                <div style={{ marginBottom: '20px' }}>
                  <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>Nội dung chi tiết</small>
                  <div style={{
                    whiteSpace: 'pre-wrap',
                    padding: '12px',
                    border: '1px solid var(--line)',
                    borderRadius: '6px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    background: 'var(--bg-input, #fff)'
                  }}>
                    {selectedDoc.description}
                  </div>
                </div>
              )}

              {/* Tệp đính kèm */}
              <div style={{ marginTop: '20px', borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
                <h3>Tệp đính kèm</h3>
                {loadingFiles ? (
                  <p>Đang tải danh sách tệp...</p>
                ) : docFiles.length === 0 ? (
                  <p style={{ color: 'var(--muted)' }}>Không có tệp đính kèm nào.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                    {docFiles.map(file => {
                      const isIssued = file.file_kind === 'issued_attachment'
                      return (
                        <div
                          key={file.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 12px',
                            border: '1px solid var(--line)',
                            borderRadius: '6px',
                            background: isIssued ? 'rgba(8, 123, 56, 0.03)' : 'var(--bg-card)'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <button
                              type="button"
                              onClick={() => void previewDocumentFile(file.id)}
                              style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--blue)', cursor: 'pointer', fontWeight: 600, textAlign: 'left', textDecoration: 'underline', textUnderlineOffset: '3px' }}
                              title={`Xem ${file.name}`}
                            >
                              {file.name}
                            </button>
                            <span style={{ fontSize: '0.8rem', color: isIssued ? '#087b38' : 'var(--muted)' }}>
                              {isIssued ? 'Tệp lưu trữ chính thức' : 'Tài liệu đính kèm'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void downloadDocumentFile(file.id).catch((error) => {
                                notify(error instanceof Error ? error.message : 'Không tải được file.', 'error')
                              })
                            }}
                            className="btn-download"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              color: 'var(--blue)',
                              textDecoration: 'none',
                              fontWeight: 500,
                              border: 0,
                              background: 'transparent',
                              cursor: 'pointer',
                              padding: 0
                            }}
                          >
                            <Download size={16} />
                            Tải về
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-form-footer">
              <button type="button" className="btn-cancel" onClick={() => setSelectedDoc(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
      {(filePreview || loadingPreview) && (
        <div className="modal file-preview-modal" style={{ zIndex: 1200 }}>
          <div className="file-preview-shell">
            <div className="modal-form-header">
              <h2>{loadingPreview ? 'Đang mở file...' : filePreview?.name}</h2>
              <button type="button" className="btn-close" onClick={closeFilePreview} disabled={loadingPreview} aria-label="Đóng xem file"><X /></button>
            </div>
            <div className="file-preview-content">
              {loadingPreview ? (
                <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>Đang tải nội dung file...</div>
              ) : filePreview?.docxBuffer ? (
                <DocxFilePreview data={filePreview.docxBuffer} />
              ) : filePreview?.docText ? (
                <DocFilePreview name={filePreview.name} text={filePreview.docText} />
              ) : filePreview?.url ? (
                <iframe title={`Xem ${filePreview.name}`} src={filePreview.url} />
              ) : (
                <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>{filePreview?.message}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
