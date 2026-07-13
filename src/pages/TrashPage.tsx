import { Eye, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { DataViewToggle, type DataViewMode } from '../components/DataViewToggle'
import { useNotifier } from '../contexts/useNotifier'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { DocumentRow } from '../types'

const typeLabels: Record<string, string> = {
  totrinh: 'Tờ Trình',
  quyetdinh: 'Quyết Định',
  khenthuong: 'Khen Thưởng',
  baocao: 'Báo Cáo',
  kehoach: 'Kế Hoạch',
  banhanh: 'Ban Hành',
}

const backendUrl = import.meta.env.VITE_BACKEND_URL
const documentContent = (document: DocumentRow) => document.description || document.title

export function TrashPage() {
  const { notify, confirmAction } = useNotifier()
  const [items, setItems] = useState<DocumentRow[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [selectedDoc, setSelectedDoc] = useState<DocumentRow | null>(null)
  const [viewMode, setViewMode] = useState<DataViewMode>('table')
  const forceGrid = useMediaQuery('(max-width: 760px)')

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
    if (!response.ok) throw new Error(payload.error || 'Backend xử lý thất bại.')
    return payload
  }

  const load = useCallback(async () => {
    try {
      const payload = await callBackend<{ ok: boolean; documents: DocumentRow[] }>('/api/list-trash-documents', {})
      setItems(payload.documents || [])
      setError('')
    } catch (error) {
      if (emitSessionExpired(error)) return
      const message = error instanceof Error ? error.message : 'Không thể tải thùng rác.'
      setError(message)
    }
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('trash-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_shares' }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  const filteredItems = useMemo(() => items.filter(doc => {
    if (!search) return true
    const keyword = search.toLowerCase()
    return doc.title.toLowerCase().includes(keyword) || !!doc.description?.toLowerCase().includes(keyword)
  }), [items, search])

  async function restore(document: DocumentRow) {
    const confirmed = await confirmAction({
      title: 'Khôi phục hồ sơ?',
      message: `Khôi phục hồ sơ "${document.title}" về danh sách hồ sơ.`,
      confirmText: 'Khôi phục',
    })
    if (!confirmed) return
    try {
      await callBackend('/api/restore-document', { documentId: document.id })
      setSelectedDoc(null)
      notify('Đã khôi phục hồ sơ.', 'success')
      void load()
    } catch (error) {
      if (emitSessionExpired(error)) return
      const message = error instanceof Error ? error.message : 'Không thể khôi phục hồ sơ.'
      setError(message)
      notify(message, 'error')
    }
  }

  async function purge(document: DocumentRow) {
    const confirmed = await confirmAction({
      title: 'Xóa vĩnh viễn?',
      message: `Xóa vĩnh viễn hồ sơ "${document.title}"? Hành động này không thể khôi phục.`,
      confirmText: 'Xóa vĩnh viễn',
      danger: true,
    })
    if (!confirmed) return
    try {
      await callBackend('/api/delete-document-permanently', { documentId: document.id })
      notify('Đã xóa vĩnh viễn hồ sơ.', 'success')
      void load()
    } catch (error) {
      if (emitSessionExpired(error)) return
      const message = error instanceof Error ? error.message : 'Không thể xóa vĩnh viễn hồ sơ.'
      setError(message)
      notify(message, 'error')
    }
  }

  async function purgeAll() {
    const confirmed = await confirmAction({
      title: 'Xóa tất cả trong thùng rác?',
      message: `Xóa vĩnh viễn ${items.length} hồ sơ trong thùng rác? Hành động này không thể khôi phục.`,
      confirmText: 'Xóa tất cả',
      danger: true,
    })
    if (!confirmed) return
    try {
      const payload = await callBackend<{ ok: boolean; deleted: number }>('/api/delete-trash-documents', {})
      notify(`Đã xóa vĩnh viễn ${payload.deleted ?? items.length} hồ sơ.`, 'success')
      void load()
    } catch (error) {
      if (emitSessionExpired(error)) return
      const message = error instanceof Error ? error.message : 'Không thể xóa toàn bộ thùng rác.'
      setError(message)
      notify(message, 'error')
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Thùng rác</h1>
          <p>Khôi phục hồ sơ đã xóa nhầm hoặc xóa vĩnh viễn hồ sơ của bạn.</p>
        </div>
        {items.length > 0 && (
          <button type="button" className="danger-icon text-button" onClick={() => void purgeAll()}>
            <Trash2 />Xóa tất cả
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <section className="toolbar">
        <label>
          <Search />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tiêu đề hoặc nội dung..." />
        </label>
        <DataViewToggle value={viewMode} onChange={setViewMode} forceGrid={forceGrid} />
        <span>{filteredItems.length} hồ sơ</span>
      </section>
      <section className={`table-card records-table-card data-view-card ${forceGrid || viewMode === 'grid' ? 'is-grid-view' : 'is-table-view'}`}>
        <table className="records-table trash-table">
          <thead>
            <tr>
              <th className="type-column">Loại</th>
              <th className="content-column">Nội dung</th>
              <th className="year-column">Năm</th>
              <th className="deleted-date-column">Ngày xóa</th>
              <th className="action-column">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map(document => (
              <tr key={document.id}>
                <td className="type-column">{typeLabels[document.type] || document.type}</td>
                <td className="content-column">
                  <span
                    className="document-summary hover-link"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedDoc(document)}
                  >
                    {documentContent(document)}
                  </span>
                </td>
                <td className="year-column">{document.document_year || new Date(document.created_at).getFullYear()}</td>
                <td className="deleted-date-column">{document.deleted_at ? new Date(document.deleted_at).toLocaleDateString('vi-VN') : '—'}</td>
                <td className="action-column">
                  <div className="row-actions record-row-actions trash-row-actions">
                    <button className="ghost compact" title="Xem chi tiết" onClick={() => setSelectedDoc(document)}>
                      <Eye />
                    </button>
                    <button className="primary compact restore-icon-button" title="Khôi phục hồ sơ" onClick={() => restore(document)}>
                      <RotateCcw />
                    </button>
                    <button className="danger-icon" title="Xóa vĩnh viễn" onClick={() => purge(document)}>
                      <Trash2 />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!filteredItems.length && <tr><td colSpan={5}><EmptyState message="Thùng rác đang trống." /></td></tr>}
          </tbody>
        </table>
        <div className="data-grid">
          {filteredItems.map(document => (
            <article className="data-card" key={document.id}>
              <div className="data-card-title-row">
                <span className="status">{typeLabels[document.type] || document.type}</span>
                <span>{document.deleted_at ? new Date(document.deleted_at).toLocaleDateString('vi-VN') : '—'}</span>
              </div>
              <button type="button" className="data-card-main hover-link" onClick={() => setSelectedDoc(document)}>
                {documentContent(document)}
              </button>
              <div className="data-card-meta">
                <span>Năm</span>
                <b>{document.document_year || new Date(document.created_at).getFullYear()}</b>
              </div>
              <div className="row-actions record-row-actions trash-row-actions data-card-actions">
                <button className="ghost compact" title="Xem chi tiết" onClick={() => setSelectedDoc(document)}>
                  <Eye />
                </button>
                <button className="primary compact restore-icon-button" title="Khôi phục hồ sơ" onClick={() => restore(document)}>
                  <RotateCcw />
                </button>
                <button className="danger-icon" title="Xóa vĩnh viễn" onClick={() => purge(document)}>
                  <Trash2 />
                </button>
              </div>
            </article>
          ))}
          {!filteredItems.length && <EmptyState message="Thùng rác đang trống." />}
        </div>
      </section>

      {selectedDoc && (
        <div className="modal">
          <div className="modal-container-style trash-detail-modal">
            <div className="modal-form-header">
              <h2>Chi tiết hồ sơ đã xóa</h2>
              <button type="button" className="btn-close" onClick={() => setSelectedDoc(null)}><X /></button>
            </div>
            <div className="modal-form-body">
              <div className="detail-meta-grid">
                <div>
                  <small>Ngày tạo</small>
                  <strong>{new Date(selectedDoc.created_at).toLocaleDateString('vi-VN')}</strong>
                </div>
                <div>
                  <small>Ngày xóa</small>
                  <strong>{selectedDoc.deleted_at ? new Date(selectedDoc.deleted_at).toLocaleDateString('vi-VN') : '—'}</strong>
                </div>
                <div>
                  <small>Loại hồ sơ</small>
                  <strong>{typeLabels[selectedDoc.type] || selectedDoc.type}</strong>
                </div>
                <div>
                  <small>Năm tài liệu</small>
                  <strong>{selectedDoc.document_year || new Date(selectedDoc.created_at).getFullYear()}</strong>
                </div>
              </div>

              <div className="detail-content-box">
                <small>Nội dung chi tiết</small>
                <div>{documentContent(selectedDoc)}</div>
              </div>
            </div>
            <div className="modal-form-footer">
              <button type="button" className="btn-cancel" onClick={() => setSelectedDoc(null)}>Đóng</button>
              <button type="button" className="btn-submit restore-button" onClick={() => void restore(selectedDoc)}>
                <RotateCcw />Khôi phục
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
