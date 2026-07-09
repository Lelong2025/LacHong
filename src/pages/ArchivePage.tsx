import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { EmptyState } from '../components/EmptyState'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'
import type { DocumentRow } from '../types'

const typeLabels: Record<string, string> = {
  totrinh: 'Tờ trình',
  quyetdinh: 'Quyết định',
  khenthuong: 'Khen thưởng',
  baocao: 'Báo cáo',
  kehoach: 'Kế hoạch',
  banhanh: 'Ban hành',
}

export function ArchivePage() {
  const { profile, user } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [items, setItems] = useState<DocumentRow[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    let query = supabase
      .from('documents')
      .select('*')
      .eq('status', 'archived')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })

    if (!isAdmin) query = query.eq('created_by', user?.id ?? '')
    if (search) query = query.ilike('title', `%${search}%`)

    const { data, error } = await query
    if (error) {
      if (emitSessionExpired(error)) return
      setError(error.message)
    }
    else setItems((data || []) as DocumentRow[])
  }, [isAdmin, user?.id, search])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('archive-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

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
        <span>{items.length} hồ sơ</span>
      </section>
      <section className="table-card">
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
      </section>
    </>
  )
}
