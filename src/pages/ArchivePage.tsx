import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { EmptyState } from '../components/EmptyState'
import { DataViewToggle, type DataViewMode } from '../components/DataViewToggle'
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

export function ArchivePage() {
  const { profile, user } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [items, setItems] = useState<DocumentRow[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<DataViewMode>('table')
  const forceGrid = useMediaQuery('(max-width: 760px)')

  const load = useCallback(async () => {
    let query = supabase
      .from('documents')
      .select('*')
      .eq('status', 'archived')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })

    if (search) query = query.ilike('title', `%${search}%`)

    const { data, error } = await query
    if (error) {
      if (emitSessionExpired(error)) return
      setError(error.message)
    }
    else setItems((data || []) as DocumentRow[])
  }, [search])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel(`archive-docs:${user?.id ?? 'anonymous'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_shares' }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load, user?.id])

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Lưu trữ hồ sơ</h1>
          <p>Danh sách các hồ sơ đã được lưu trữ{isAdmin ? ' toàn hệ thống' : ' của bạn'}.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="toolbar">
        <label>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm theo tiêu đề..."
          />
        </label>
        <DataViewToggle value={viewMode} onChange={setViewMode} forceGrid={forceGrid} />
        <span>{items.length} hồ sơ</span>
      </section>
      <section className={`table-card data-view-card ${forceGrid || viewMode === 'grid' ? 'is-grid-view' : 'is-table-view'}`}>
        <table>
          <thead>
            <tr>
              <th>Loại</th>
              <th>Tiêu đề</th>
              <th>Năm</th>
              {isAdmin && <th>Người thực hiện</th>}
              <th>Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {items.map(doc => (
              <tr key={doc.id}>
                <td>{typeLabels[doc.type] || doc.type}</td>
                <td><b>{doc.title}</b><small>{doc.description}</small></td>
                <td>{doc.document_year || new Date(doc.created_at).getFullYear()}</td>
                {isAdmin && <td>{doc.assignee_name || <span style={{ color: 'var(--muted)' }}>—</span>}</td>}
                <td>{new Date(doc.updated_at).toLocaleDateString('vi-VN')}</td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={isAdmin ? 5 : 4}>
                <EmptyState message="Chưa có hồ sơ nào được lưu trữ." />
              </td></tr>
            )}
          </tbody>
        </table>
        <div className="data-grid">
          {items.map(doc => (
            <article className="data-card" key={doc.id}>
              <div className="data-card-title-row">
                <span className="status">{typeLabels[doc.type] || doc.type}</span>
                <span>{new Date(doc.updated_at).toLocaleDateString('vi-VN')}</span>
              </div>
              <div className="data-card-main text-only">
                <b>{doc.title}</b>
                {doc.description && <small>{doc.description}</small>}
              </div>
              <div className="data-card-meta">
                <span>Năm</span>
                <b>{doc.document_year || new Date(doc.created_at).getFullYear()}</b>
              </div>
              {isAdmin && (
                <div className="data-card-meta">
                  <span>Người thực hiện</span>
                  <b>{doc.assignee_name || '—'}</b>
                </div>
              )}
            </article>
          ))}
          {!items.length && <EmptyState message="Chưa có hồ sơ nào được lưu trữ." />}
        </div>
      </section>
    </>
  )
}
