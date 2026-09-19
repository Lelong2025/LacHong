import {
  Eye,
  Search,
  X,
  Send,
  Stamp,
  CheckCircle2,
  FileText,
  Clock3,
  Hash,
  FolderOpen,
  Download,
  BadgeCheck,
  Mail,
  Bell,
  ClipboardList,
  Newspaper,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Award,
  Calendar,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { useAuth } from '../contexts/AuthContext'
import { useNotifier } from '../contexts/useNotifier'
import { EmptyState } from '../components/EmptyState'
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
  duatin: 'Đưa Tin',
}

const labels: Record<string, string> = {
  ...documentTypeLabels,
  chuabanhanh: 'Chưa Ban Hành',
  banhanh: 'Ban Hành',
}

const assigneeLabel = (option: AssigneeOption) =>
  option.full_name ? `${option.full_name} (${option.email})` : option.email

const backendUrl = import.meta.env.VITE_BACKEND_URL

const parseAssigneeNames = (value: string | null): AssigneeOption[] => {
  if (!value) return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
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
      {assignees.map(assignee => (
        <span className="assignee-cell-item" key={assignee.email} title={assigneeLabel(assignee)}>
          <b>{assignee.full_name || assignee.email}</b>
          {assignee.full_name && <small>{assignee.email}</small>}
        </span>
      ))}
    </div>
  )
}

const documentContent = (document: DocumentRow) => document.description || document.title

const matchesFilter = (document: DocumentRow, filter: string) => {
  if (!filter) return true
  if (filter === 'banhanh') return document.status === 'issued'
  if (filter === 'chuabanhanh') return document.status !== 'issued'
  return document.type === filter
}

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
  const binaryString = atob(contentBase64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i)
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
        Hiển thị <b>{startItem}</b> - <b>{endItem}</b> trong tổng số <b>{totalItems}</b> hồ sơ
      </div>
      <div className="pagination-controls">
        <button
          type="button"
          className="pagination-btn pagination-nav-btn"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Trang trước"
        >
          <ChevronLeft size={16} />
        </button>
        {getPageNumbers().map((page, idx) => {
          if (page === '...') {
            return (
              <span key={`ellipsis-${idx}`} className="pagination-ellipsis">
                ...
              </span>
            )
          }
          const pageNum = Number(page)
          return (
            <button
              key={pageNum}
              type="button"
              className={`pagination-btn ${pageNum === currentPage ? 'active' : ''}`}
              onClick={() => onPageChange(pageNum)}
            >
              {pageNum}
            </button>
          )
        })}
        <button
          type="button"
          className="pagination-btn pagination-nav-btn"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Trang tiếp"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
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
          placeholder="Tìm người thực hiện..."
          className="combobox-search-input"
        />
        {query && (
          <button
            type="button"
            className="combobox-clear-btn"
            onClick={handleClear}
            title="Xóa tìm kiếm"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="assignee-combobox-dropdown">
          <div
            className={`assignee-combobox-option ${!value ? 'is-selected' : ''}`}
            onClick={() => handleSelect('')}
          >
            <span className="option-name">Tất cả người thực hiện</span>
          </div>
          {filtered.map(opt => {
            const isSelected = value === opt.email || value === opt.full_name
            return (
              <div
                key={opt.email}
                className={`assignee-combobox-option ${isSelected ? 'is-selected' : ''}`}
                onClick={() => handleSelect(opt.email)}
              >
                <div className="option-content">
                  <span className="option-name">{opt.full_name || opt.email}</span>
                  {opt.full_name && <small className="option-email">{opt.email}</small>}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="assignee-combobox-empty">Không tìm thấy người thực hiện.</div>
          )}
        </div>
      )}
    </div>
  )
}

export function KpiPage() {
  const { user, profile } = useAuth()
  const { notify } = useNotifier()
  const forceGrid = useMediaQuery('(max-width: 900px)')

  const [allDocs, setAllDocs] = useState<DocumentRow[]>([])
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [search, setSearch] = useState('')
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [viewMode, setViewMode] = useState<DataViewMode>('table')
  const [currentPage, setCurrentPage] = useState(1)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Detail modal state
  const [selectedDoc, setSelectedDoc] = useState<DocumentRow | null>(null)
  const [docFiles, setDocFiles] = useState<{ id: string; name: string; object_path: string | null; file_kind: string }[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const PAGE_SIZE = 10
  const isAdmin = profile?.role === 'admin'

  async function callBackend<T>(path: string, body?: unknown): Promise<T> {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      emitSessionExpired('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
      throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
    }

    const response = await fetch(`${backendUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
    if (!response.ok) {
      const message = payload.error || 'Backend xử lý thất bại.'
      if (response.status === 401) emitSessionExpired(message)
      throw new Error(message)
    }
    return payload
  }

  const load = useCallback(async () => {
    const query = supabase
      .from('documents')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })

    const { data, error: err } = await query
    if (err) {
      if (emitSessionExpired(err)) return
      setError(err.message)
    } else {
      setAllDocs((data || []) as DocumentRow[])
    }
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel(`kpi-documents:${user?.id ?? 'admin'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => {
        void load()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load, user?.id])

  // Lọc theo thời gian (Tháng / Năm)
  const docsInTimeRange = useMemo(() => {
    return allDocs.filter(doc => {
      const docDate = new Date(doc.created_at)
      if (yearFilter && String(doc.document_year || docDate.getFullYear()) !== yearFilter) {
        return false
      }
      if (monthFilter && String(docDate.getMonth() + 1) !== monthFilter) {
        return false
      }
      return true
    })
  }, [allDocs, yearFilter, monthFilter])

  // Thống kê 2 chỉ số KPI chính dựa trên khoảng thời gian được chọn
  const kpiStats = useMemo(() => {
    const totalDocs = docsInTimeRange.length
    const totalChecked = docsInTimeRange.filter(d => Boolean(d.is_checked)).length
    const totalSigned = docsInTimeRange.filter(d => Boolean(d.is_signed)).length
    const totalBoth = docsInTimeRange.filter(d => Boolean(d.is_checked && d.is_signed)).length
    return {
      totalDocs,
      totalChecked,
      totalSigned,
      totalBoth,
    }
  }, [docsInTimeRange])

  // Lọc theo loại, tìm kiếm, người thực hiện
  const filteredItems = useMemo(() => {
    const searchLower = search.trim().toLowerCase()
    const assigneeLower = assigneeSearch.trim().toLowerCase()

    const list = docsInTimeRange.filter(doc => {
      // Lọc loại
      if (typeFilter && !matchesFilter(doc, typeFilter)) return false

      // Tìm kiếm theo nội dung / tiêu đề
      if (searchLower) {
        const textMatch =
          doc.title.toLowerCase().includes(searchLower) ||
          (doc.description && doc.description.toLowerCase().includes(searchLower))
        if (!textMatch) return false
      }

      // Tìm kiếm theo người thực hiện
      if (assigneeLower) {
        if (!doc.assignee_name) return false
        const assigneeMatch = doc.assignee_name.toLowerCase().includes(assigneeLower)
        if (!assigneeMatch) return false
      }

      return true
    })

    // QUY TẮC SẮP XẾP ĐẶC BIỆT:
    // - Hồ sơ được tick CẢ 2 Ô (Đã check AND Đã ký): Đẩy xuống DƯỚI CÙNG
    // - Hồ sơ chưa tick hoặc chỉ tick 1 trong 2: Giữ nguyên ở TRÊN (mới nhất trên cùng)
    return [...list].sort((a, b) => {
      const aBoth = Boolean(a.is_checked && a.is_signed)
      const bBoth = Boolean(b.is_checked && b.is_signed)
      if (aBoth !== bBoth) {
        return aBoth ? 1 : -1
      }
      // Cùng nhóm thì xếp theo thời gian cập nhật mới nhất
      const timeA = new Date(a.updated_at || a.created_at).getTime()
      const timeB = new Date(b.updated_at || b.created_at).getTime()
      return timeB - timeA
    })
  }, [docsInTimeRange, typeFilter, search, assigneeSearch])

  // Danh sách năm có trong dữ liệu
  const availableYears = useMemo(() => {
    const years = new Set<number>()
    years.add(new Date().getFullYear())
    for (const doc of allDocs) {
      if (doc.document_year) years.add(doc.document_year)
      else if (doc.created_at) years.add(new Date(doc.created_at).getFullYear())
    }
    return Array.from(years).sort((a, b) => b - a)
  }, [allDocs])

  // Danh sách người thực hiện duy nhất để chọn combobox
  const allAssigneeOptions = useMemo(() => {
    const map = new Map<string, AssigneeOption>()
    for (const doc of allDocs) {
      if (!doc.assignee_name) continue
      const list = parseAssigneeNames(doc.assignee_name)
      for (const item of list) {
        if (!map.has(item.email)) {
          map.set(item.email, item)
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
  }, [allDocs])

  // Đếm theo loại trong khoảng thời gian
  const typeCounts = useMemo(() => {
    return Object.fromEntries(
      Object.keys(labels).map(key => [
        key,
        docsInTimeRange.filter(doc => matchesFilter(doc, key)).length,
      ])
    )
  }, [docsInTimeRange])

  useEffect(() => {
    setCurrentPage(1)
  }, [typeFilter, yearFilter, monthFilter, search, assigneeSearch])

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages)

  const paginatedItems = useMemo(() => {
    const startIndex = (validCurrentPage - 1) * PAGE_SIZE
    return filteredItems.slice(startIndex, startIndex + PAGE_SIZE)
  }, [filteredItems, validCurrentPage])

  // Xử lý toggle trực tiếp ô "Đã check" hoặc "Đã ký"
  async function handleToggleKpi(document: DocumentRow, field: 'check' | 'sign') {
    if (!isAdmin) {
      notify('Chỉ quản trị viên mới có quyền cập nhật KPI.', 'warning')
      return
    }

    const nextChecked = field === 'check' ? !document.is_checked : Boolean(document.is_checked)
    const nextSigned = field === 'sign' ? !document.is_signed : Boolean(document.is_signed)

    // Optimistic UI update: cập nhật state tức thời để người dùng thấy mượt mà và card nhảy số ngay
    setAllDocs(prev =>
      prev.map(d => {
        if (d.id === document.id) {
          return {
            ...d,
            is_checked: nextChecked,
            checked_by: nextChecked ? 'Lê Phương Long' : null,
            checked_at: nextChecked ? new Date().toISOString() : null,
            is_signed: nextSigned,
            signed_by: nextSigned ? 'Nguyễn Thanh Sơn' : null,
            signed_at: nextSigned ? new Date().toISOString() : null,
          }
        }
        return d
      })
    )

    // Nếu modal chi tiết đang mở đúng hồ sơ này thì cũng cập nhật luôn
    setSelectedDoc(current => {
      if (current && current.id === document.id) {
        return {
          ...current,
          is_checked: nextChecked,
          checked_by: nextChecked ? 'Lê Phương Long' : null,
          checked_at: nextChecked ? new Date().toISOString() : null,
          is_signed: nextSigned,
          signed_by: nextSigned ? 'Nguyễn Thanh Sơn' : null,
          signed_at: nextSigned ? new Date().toISOString() : null,
        }
      }
      return current
    })

    setUpdatingId(document.id)
    try {
      await callBackend('/api/update-document-kpi', {
        documentId: document.id,
        isChecked: nextChecked,
        isSigned: nextSigned,
      })
      notify(
        field === 'check'
          ? nextChecked
            ? 'Đã ghi nhận ĐÃ CHECK (Lê Phương Long).'
            : 'Đã hủy ĐÃ CHECK.'
          : nextSigned
            ? 'Đã ghi nhận ĐÃ KÝ (Nguyễn Thanh Sơn).'
            : 'Đã hủy ĐÃ KÝ.',
        'success'
      )
    } catch (err) {
      // Rollback nếu thất bại
      setAllDocs(prev =>
        prev.map(d => (d.id === document.id ? document : d))
      )
      const msg = err instanceof Error ? err.message : 'Không cập nhật được trạng thái KPI.'
      notify(msg, 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  // Mở modal xem chi tiết
  async function handleViewDetail(doc: DocumentRow) {
    setSelectedDoc(doc)
    setLoadingFiles(true)
    setDocFiles([])
    try {
      const { data, error: err } = await supabase
        .from('document_files')
        .select('id, name, object_path, file_kind')
        .eq('document_id', doc.id)
        .is('deleted_at', null)
      if (err) throw err
      setDocFiles((data || []) as { id: string; name: string; object_path: string | null; file_kind: string }[])
    } catch (err) {
      if (emitSessionExpired(err)) return
      console.error('Lỗi khi tải file đính kèm:', err)
    } finally {
      setLoadingFiles(false)
    }
  }

  // Tải file đính kèm
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

  // Xem trực tiếp file đính kèm
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
    } catch (err) {
      if (emitSessionExpired(err)) return
      notify(err instanceof Error ? err.message : 'Không xem được file.', 'error')
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

  useEffect(() => {
    if (!selectedDoc) return

    const loadSelectedDocFiles = async () => {
      setLoadingFiles(true)
      try {
        const { data, error: err } = await supabase
          .from('document_files')
          .select('id, name, object_path, file_kind')
          .eq('document_id', selectedDoc.id)
          .is('deleted_at', null)
        if (err) throw err
        setDocFiles((data || []) as { id: string; name: string; object_path: string | null; file_kind: string }[])
      } catch (err) {
        if (emitSessionExpired(err)) return
        console.error('Lỗi khi tải file đính kèm:', err)
      } finally {
        setLoadingFiles(false)
      }
    }

    const channel = supabase
      .channel(`kpi-document-detail-files:${selectedDoc.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'document_files',
        filter: `document_id=eq.${selectedDoc.id}`,
      }, () => { void loadSelectedDocFiles() })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [selectedDoc])

  // Xuất file Excel KPI
  function exportExcelFile() {
    if (!filteredItems.length) {
      notify('Không có hồ sơ nào để xuất Excel.', 'warning')
      return
    }

    const rows = filteredItems.map(doc => ({
      'Loại hồ sơ': documentTypeLabels[doc.type] || doc.type,
      'Nội dung': documentContent(doc),
      'Người thực hiện': doc.assignee_name || 'Chưa gán',
      'Đã check (Lê Phương Long)': doc.is_checked ? 'Đã check' : 'Chưa check',
      'Đã ký (Nguyễn Thanh Sơn)': doc.is_signed ? 'Đã ký' : 'Chưa ký',
      'Năm tài liệu': doc.document_year || new Date(doc.created_at).getFullYear(),
      'Ngày tạo': new Date(doc.created_at).toLocaleDateString('vi-VN'),
    }))

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: [
        'Loại hồ sơ',
        'Nội dung',
        'Người thực hiện',
        'Đã check (Lê Phương Long)',
        'Đã ký (Nguyễn Thanh Sơn)',
        'Năm tài liệu',
        'Ngày tạo',
      ],
    })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Báo Cáo KPI')
    const timeLabel = `${monthFilter ? `Thang_${monthFilter}_` : ''}${yearFilter ? `Nam_${yearFilter}_` : ''}`
    XLSX.writeFile(workbook, `Bao_Cao_KPI_${timeLabel}${new Date().toISOString().slice(0, 10)}.xlsx`)
    notify('Đã tải xuống file Excel KPI.', 'success')
  }

  // Nếu không phải admin thì chuyển hướng về trang chủ
  if (!isAdmin) {
    return <Navigate to="/" replace />
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
    { key: 'duatin', label: 'Đưa Tin', icon: Newspaper },
    { key: 'banhanh', label: 'Ban Hành', icon: Hash },
  ]

  const monthOptions = [
    { value: '', label: 'Tất cả tháng' },
    ...Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: `Tháng ${i + 1}`,
    })),
  ]

  const yearOptions = [
    { value: '', label: 'Tất cả năm' },
    ...availableYears.map(y => ({ value: String(y), label: `Năm ${y}` })),
  ]

  return (
    <>
      {/* Header trang KPI */}
      <div className="page-heading kpi-page-heading">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="kpi-badge-tag"><Award size={16} /> Đánh giá KPI</span>
          </div>
          <h1 style={{ marginTop: '4px' }}>Theo dõi &amp; Đánh giá KPI</h1>
          <p>Rà soát tiến độ kiểm tra, ký duyệt và theo dõi chỉ số KPI hồ sơ khoa học &amp; ứng dụng.</p>
        </div>

        {/* Bộ lọc Tháng & Năm ở góc trên bên phải */}
        <div className="kpi-header-time-filter">
          <div className="kpi-time-picker-card">
            <span className="kpi-time-label">
              <Calendar size={15} /> Khoảng thời gian:
            </span>
            <div className="kpi-select-row">
              <CustomSelect
                className="kpi-month-combobox"
                value={monthFilter}
                onChange={setMonthFilter}
                ariaLabel="Lọc theo tháng"
                options={monthOptions}
              />
              <CustomSelect
                className="kpi-year-combobox"
                value={yearFilter}
                onChange={setYearFilter}
                ariaLabel="Lọc theo năm"
                options={yearOptions}
              />
              {(monthFilter || yearFilter) && (
                <button
                  type="button"
                  className="ghost compact"
                  onClick={() => {
                    setMonthFilter('')
                    setYearFilter('')
                  }}
                  title="Đặt lại thời gian về tất cả"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <button type="button" className="export-excel-button" onClick={exportExcelFile}>
            <Download size={16} /> Xuất Excel KPI
          </button>
        </div>
      </div>

      {/* TẦNG 1: 2 CARD BỘ ĐẾM TỔNG KPI */}
      <section className="kpi-metrics-hero-grid">
        {/* Card 1: Tổng số Đã check (Lê Phương Long) */}
        <article className="kpi-hero-card kpi-hero-card-checked">
          <div className="kpi-hero-icon-wrap check-icon-wrap">
            <ShieldCheck size={28} />
          </div>
          <div className="kpi-hero-info">
            <div className="kpi-hero-title-row">
              <span className="kpi-hero-subtitle">Người check</span>
              <span className="kpi-hero-person-tag">Lê Phương Long</span>
            </div>
            <div className="kpi-hero-main-stat">
              <span className="kpi-hero-number">{kpiStats.totalChecked}</span>
              <span className="kpi-hero-sublabel">/ {kpiStats.totalDocs} hồ sơ đã check</span>
            </div>
            <div className="kpi-hero-progress-bar">
              <div
                className="kpi-hero-progress-fill progress-fill-checked"
                style={{
                  width: `${kpiStats.totalDocs ? Math.round((kpiStats.totalChecked / kpiStats.totalDocs) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        </article>

        {/* Card 2: Tổng số Đã ký (Nguyễn Thanh Sơn) */}
        <article className="kpi-hero-card kpi-hero-card-signed">
          <div className="kpi-hero-icon-wrap sign-icon-wrap">
            <Stamp size={28} />
          </div>
          <div className="kpi-hero-info">
            <div className="kpi-hero-title-row">
              <span className="kpi-hero-subtitle">Người ký</span>
              <span className="kpi-hero-person-tag">Nguyễn Thanh Sơn</span>
            </div>
            <div className="kpi-hero-main-stat">
              <span className="kpi-hero-number">{kpiStats.totalSigned}</span>
              <span className="kpi-hero-sublabel">/ {kpiStats.totalDocs} hồ sơ đã ký</span>
            </div>
            <div className="kpi-hero-progress-bar">
              <div
                className="kpi-hero-progress-fill progress-fill-signed"
                style={{
                  width: `${kpiStats.totalDocs ? Math.round((kpiStats.totalSigned / kpiStats.totalDocs) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        </article>
      </section>

      {/* TẦNG 2: BỘ LỌC THEO LOẠI HỒ SƠ */}
      <section className="metric-grid documents-metrics-row" style={{ marginBottom: '1.5rem', marginTop: '1.25rem' }}>
        <article
          className={`metric-card clickable ${!typeFilter ? 'active' : ''}`}
          onClick={() => setTypeFilter('')}
          style={{ cursor: 'pointer' }}
        >
          <span className="metric-icon"><FolderOpen /></span>
          <span className="metric-copy">
            <span>Tất cả hồ sơ</span>
            <b>{docsInTimeRange.length}</b>
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

      {/* TOOLBAR */}
      <section className="toolbar documents-toolbar">
        <label className="toolbar-search-input">
          <Search />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Tìm theo tiêu đề hoặc nội dung hồ sơ..."
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
        <DataViewToggle value={viewMode} onChange={setViewMode} forceGrid={forceGrid} />
        <span style={{ fontSize: '0.88rem', color: 'var(--muted)', fontWeight: 500 }}>
          {filteredItems.length} hồ sơ hiển thị
        </span>
      </section>

      {error && <p className="error">{error}</p>}

      {/* BẢNG DỮ LIỆU / CARD GRID */}
      <section
        className={`table-card records-table-card data-view-card ${
          forceGrid || viewMode === 'grid' ? 'is-grid-view' : 'is-table-view'
        }`}
      >
        <table className="records-table kpi-table">
          <thead>
            <tr>
              <th className="type-column">Loại</th>
              <th className="content-column">Nội dung</th>
              <th className="assignee-column">Người thực hiện</th>
              <th className="kpi-check-sign-column">Đã check / Đã ký</th>
              <th className="year-column">Năm</th>
              <th className="action-column">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map(document => {
              const isBothChecked = Boolean(document.is_checked && document.is_signed)
              const isBusy = updatingId === document.id

              return (
                <tr
                  key={document.id}
                  className={`kpi-table-row ${isBothChecked ? 'is-completed-both' : ''}`}
                >
                  <td className="type-column">
                    <span className="kpi-doc-type-badge">
                      {documentTypeLabels[document.type] || document.type}
                    </span>
                  </td>
                  <td className="content-column">
                    <span
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleViewDetail(document)}
                      className="document-summary hover-link"
                      title="Bấm để xem chi tiết hồ sơ"
                    >
                      {documentContent(document)}
                    </span>
                  </td>
                  <td className="assignee-column">
                    <AssigneeCell value={document.assignee_name} />
                  </td>
                  <td className="kpi-check-sign-column">
                    <div className="kpi-checkbox-group">
                      <label
                        className={`kpi-check-item ${document.is_checked ? 'checked' : ''}`}
                        title="Tick để ghi nhận Người check: Lê Phương Long"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(document.is_checked)}
                          disabled={isBusy}
                          onChange={() => handleToggleKpi(document, 'check')}
                        />
                        <span>Đã check</span>
                      </label>
                      <label
                        className={`kpi-check-item ${document.is_signed ? 'signed' : ''}`}
                        title="Tick để ghi nhận Người ký: Nguyễn Thanh Sơn"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(document.is_signed)}
                          disabled={isBusy}
                          onChange={() => handleToggleKpi(document, 'sign')}
                        />
                        <span>Đã ký</span>
                      </label>
                    </div>
                  </td>
                  <td className="year-column">
                    {document.document_year || new Date(document.created_at).getFullYear()}
                  </td>
                  <td className="action-column">
                    <div className="row-actions record-row-actions">
                      <button
                        className="ghost compact"
                        title="Xem chi tiết hồ sơ"
                        onClick={() => handleViewDetail(document)}
                      >
                        <Eye />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!filteredItems.length && (
              <tr>
                <td colSpan={6}>
                  <EmptyState message="Không tìm thấy hồ sơ nào phù hợp với bộ lọc KPI." />
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* DẠNG THẺ (CARD VIEW) CHO MOBILE / TABLET */}
        <div className="data-grid document-data-grid">
          {paginatedItems.map(document => {
            const isBothChecked = Boolean(document.is_checked && document.is_signed)
            const isBusy = updatingId === document.id

            return (
              <article
                className={`data-card kpi-data-card ${isBothChecked ? 'is-completed-both' : ''}`}
                key={document.id}
              >
                <div className="data-card-title-row">
                  <span className="status">{documentTypeLabels[document.type] || document.type}</span>
                  {isBothChecked && <span className="kpi-done-pill">✓ Đã hoàn tất</span>}
                </div>
                <button
                  type="button"
                  className="data-card-main hover-link"
                  onClick={() => handleViewDetail(document)}
                >
                  {documentContent(document)}
                </button>
                <div className="data-card-meta">
                  <span>Người thực hiện</span>
                  <b>{document.assignee_name || 'Chưa gán'}</b>
                </div>
                <div className="data-card-meta kpi-check-meta">
                  <span style={{ fontWeight: 600 }}>Đã check / Đã ký:</span>
                  <div className="kpi-checkbox-group kpi-checkbox-group-inline">
                    <label className={`kpi-check-item ${document.is_checked ? 'checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(document.is_checked)}
                        disabled={isBusy}
                        onChange={() => handleToggleKpi(document, 'check')}
                      />
                      <span>Đã check</span>
                    </label>
                    <label className={`kpi-check-item ${document.is_signed ? 'signed' : ''}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(document.is_signed)}
                        disabled={isBusy}
                        onChange={() => handleToggleKpi(document, 'sign')}
                      />
                      <span>Đã ký</span>
                    </label>
                  </div>
                </div>
                <div className="data-card-meta">
                  <span>Năm</span>
                  <b>{document.document_year || new Date(document.created_at).getFullYear()}</b>
                </div>
                <div className="row-actions record-row-actions document-row-actions data-card-actions">
                  <button
                    type="button"
                    className="ghost compact"
                    title="Xem chi tiết"
                    onClick={() => handleViewDetail(document)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'auto', padding: '0 12px', height: '36px' }}
                  >
                    <Eye size={16} />
                    <span>Xem chi tiết</span>
                  </button>
                </div>
              </article>
            )
          })}
          {!filteredItems.length && (
            <EmptyState message="Không tìm thấy hồ sơ nào phù hợp với bộ lọc KPI." />
          )}
        </div>

        {/* Phân trang */}
        <PaginationBar
          currentPage={validCurrentPage}
          totalPages={totalPages}
          totalItems={filteredItems.length}
          pageSize={PAGE_SIZE}
          onPageChange={setCurrentPage}
        />
      </section>

      {/* MODAL XEM CHI TIẾT HỒ SƠ (FLOW: Người thực hiện -> Người check -> Người ký) */}
      {selectedDoc && (
        <div className="modal" onClick={() => setSelectedDoc(null)}>
          <div
            className="modal-container-style"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '700px', width: '92%' }}
          >
            <div className="modal-form-header">
              <h2>Chi tiết hồ sơ</h2>
              <button
                type="button"
                className="btn-close"
                onClick={() => setSelectedDoc(null)}
                title="Đóng"
              >
                <X />
              </button>
            </div>

            <div className="modal-form-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
              <div className="kpi-modal-info-grid">
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
                  <small style={{ color: 'var(--muted)', display: 'block' }}>Trạng thái KPI</small>
                  <strong>
                    {selectedDoc.is_checked && selectedDoc.is_signed
                      ? 'Đã check & Đã ký'
                      : selectedDoc.is_checked
                        ? 'Đã check (Chưa ký)'
                        : selectedDoc.is_signed
                          ? 'Đã ký (Chưa check)'
                          : 'Chưa check & Chưa ký'}
                  </strong>
                </div>
              </div>

              {/* 1. KHỐI NGƯỜI THỰC HIỆN */}
              <div
                style={{
                  marginBottom: '14px',
                  padding: '12px',
                  background: 'var(--bg-card, #f8fafc)',
                  borderRadius: '6px',
                  border: '1px solid var(--line)',
                }}
              >
                <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>
                  1. Người thực hiện
                </small>
                {parseAssigneeNames(selectedDoc.assignee_name).length > 0 ? (
                  <div className="assignee-detail-list">
                    {parseAssigneeNames(selectedDoc.assignee_name).map(assignee => (
                      <div key={assignee.email}>- {assigneeLabel(assignee)}</div>
                    ))}
                  </div>
                ) : (
                  <strong>Không có người thực hiện cụ thể</strong>
                )}
              </div>

              {/* 2. KHỐI NGƯỜI CHECK (CHỈ HIỂN THỊ NẾU ĐƯỢC TICK: Lê Phương Long) */}
              {selectedDoc.is_checked && (
                <div
                  style={{
                    marginBottom: '14px',
                    padding: '12px',
                    background: 'rgba(16, 185, 129, 0.08)',
                    borderRadius: '6px',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <small style={{ color: '#059669', display: 'block', fontWeight: 600 }}>
                      2. Người check
                    </small>
                    <span style={{ fontSize: '0.75rem', color: '#059669', background: 'rgba(16, 185, 129, 0.15)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                      ✓ Đã kiểm tra
                    </span>
                  </div>
                  <strong style={{ fontSize: '1.05rem', color: 'var(--text-main)' }}>
                    {selectedDoc.checked_by || 'Lê Phương Long'}
                  </strong>
                  {selectedDoc.checked_at && (
                    <small style={{ color: 'var(--muted)', display: 'block', marginTop: '4px' }}>
                      Thời gian check: {new Date(selectedDoc.checked_at).toLocaleString('vi-VN')}
                    </small>
                  )}
                </div>
              )}

              {/* 3. KHỐI NGƯỜI KÝ (CHỈ HIỂN THỊ NẾU ĐƯỢC TICK: Nguyễn Thanh Sơn) */}
              {selectedDoc.is_signed && (
                <div
                  style={{
                    marginBottom: '14px',
                    padding: '12px',
                    background: 'rgba(59, 130, 246, 0.08)',
                    borderRadius: '6px',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <small style={{ color: '#2563eb', display: 'block', fontWeight: 600 }}>
                      3. Người ký
                    </small>
                    <span style={{ fontSize: '0.75rem', color: '#2563eb', background: 'rgba(59, 130, 246, 0.15)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                      ✓ Đã ký duyệt
                    </span>
                  </div>
                  <strong style={{ fontSize: '1.05rem', color: 'var(--text-main)' }}>
                    {selectedDoc.signed_by || 'Nguyễn Thanh Sơn'}
                  </strong>
                  {selectedDoc.signed_at && (
                    <small style={{ color: 'var(--muted)', display: 'block', marginTop: '4px' }}>
                      Thời gian ký: {new Date(selectedDoc.signed_at).toLocaleString('vi-VN')}
                    </small>
                  )}
                </div>
              )}

              {/* NỘI DUNG CHI TIẾT */}
              {selectedDoc.description && (
                <div style={{ marginBottom: '20px' }}>
                  <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>
                    Nội dung chi tiết
                  </small>
                  <div
                    style={{
                      whiteSpace: 'pre-wrap',
                      padding: '12px',
                      border: '1px solid var(--line)',
                      borderRadius: '6px',
                      maxHeight: '200px',
                      overflowY: 'auto',
                      background: 'var(--bg-input, #fff)',
                    }}
                  >
                    {selectedDoc.description}
                  </div>
                </div>
              )}

              {/* TỆP ĐÍNH KÈM */}
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
                            background: isIssued ? 'rgba(8, 123, 56, 0.03)' : 'var(--bg-card)',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <button
                              type="button"
                              onClick={() => void previewDocumentFile(file.id)}
                              style={{
                                border: 0,
                                padding: 0,
                                background: 'transparent',
                                color: 'var(--blue)',
                                cursor: 'pointer',
                                fontWeight: 600,
                                textAlign: 'left',
                                textDecoration: 'underline',
                                textUnderlineOffset: '3px',
                              }}
                              title={`Xem trực tiếp ${file.name}`}
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
                              void downloadDocumentFile(file.id).catch(err => {
                                notify(err instanceof Error ? err.message : 'Không tải được file.', 'error')
                              })
                            }}
                            className="btn-download ghost compact"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
                          >
                            <Download size={15} /> Tải về
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-form-footer">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setSelectedDoc(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL XEM TRỰC TIẾP TỆP ĐÍNH KÈM (DOCX, DOC, PDF, ẢNH, v.v.) */}
      {(filePreview || loadingPreview) && (
        <div className="modal file-preview-modal" style={{ zIndex: 1200 }}>
          <div className="file-preview-shell">
            <div className="modal-form-header">
              <h2>{loadingPreview ? 'Đang mở file...' : filePreview?.name}</h2>
              <button
                type="button"
                className="btn-close"
                onClick={closeFilePreview}
                disabled={loadingPreview}
                aria-label="Đóng xem file"
              >
                <X />
              </button>
            </div>
            <div className="file-preview-content">
              {loadingPreview ? (
                <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
                  Đang tải nội dung file...
                </div>
              ) : filePreview?.docxBuffer ? (
                <DocxFilePreview data={filePreview.docxBuffer} />
              ) : filePreview?.docText ? (
                <DocFilePreview name={filePreview.name} text={filePreview.docText} />
              ) : filePreview?.url ? (
                <iframe title={`Xem ${filePreview.name}`} src={filePreview.url} />
              ) : (
                <div
                  style={{
                    height: '100%',
                    display: 'grid',
                    placeItems: 'center',
                    padding: '32px',
                    textAlign: 'center',
                    color: 'var(--muted)',
                  }}
                >
                  {filePreview?.message}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
