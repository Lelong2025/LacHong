import { RotateCcw, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { DocumentRow } from '../types'

const typeLabels: Record<string, string> = {
  totrinh: 'Tờ trình',
  quyetdinh: 'Quyết định',
  khenthuong: 'Khen thưởng',
  baocao: 'Báo cáo',
  kehoach: 'Kế hoạch',
  banhanh: 'Ban hành',
}

const backendUrl = import.meta.env.VITE_BACKEND_URL

export function TrashPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<DocumentRow[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .not('deleted_at', 'is', null)
      .eq('deleted_by', user?.id ?? '')
      .order('deleted_at', { ascending: false })

    if (error) setError(error.message)
    else setItems((data || []) as DocumentRow[])
  }, [user?.id])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('trash-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  const filteredItems = useMemo(() => items.filter(doc => {
    if (!search) return true
    const keyword = search.toLowerCase()
    return doc.title.toLowerCase().includes(keyword) || !!doc.description?.toLowerCase().includes(keyword)
  }), [items, search])

  async function restore(document: DocumentRow) {
    if (!confirm(`Khôi phục hồ sơ "${document.title}"?`)) return
    const { error } = await supabase
      .from('documents')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', document.id)
      .eq('deleted_by', user?.id ?? '')

    if (error) setError(error.message)
    else void load()
  }

  async function purge(document: DocumentRow) {
    if (!confirm(`Xóa vĩnh viễn hồ sơ "${document.title}"? Hành động này không thể khôi phục.`)) return
    try {
      if (!backendUrl) throw new Error('Thiếu VITE_BACKEND_URL trong .env.')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Phiên đăng nhập không hợp lệ.')

      const response = await fetch(`${backendUrl}/api/delete-document-permanently`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ documentId: document.id }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Không thể xóa vĩnh viễn hồ sơ.')
      void load()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Không thể xóa vĩnh viễn hồ sơ.')
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Thùng rác</h1>
          <p>Khôi phục hồ sơ đã xóa nhầm hoặc xóa vĩnh viễn hồ sơ của bạn.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="toolbar">
        <label>
          <Search />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tiêu đề hoặc nội dung..." />
        </label>
        <span>{filteredItems.length} hồ sơ</span>
      </section>
      <section className="table-card">
        <table>
          <thead>
            <tr>
              <th>Loại</th>
              <th>Tiêu đề / Nội dung</th>
              <th>Năm</th>
              <th>Ngày xóa</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map(document => (
              <tr key={document.id}>
                <td>{typeLabels[document.type] || document.type}</td>
                <td><b>{document.title}</b><small>{document.description}</small></td>
                <td>{document.document_year || new Date(document.created_at).getFullYear()}</td>
                <td>{document.deleted_at ? new Date(document.deleted_at).toLocaleDateString('vi-VN') : '—'}</td>
                <td>
                  <div className="row-actions">
                    <button className="primary compact" title="Khôi phục hồ sơ" onClick={() => restore(document)} style={{ backgroundColor: '#087b38' }}>
                      <RotateCcw />Khôi phục
                    </button>
                    <button className="danger-icon text-button" title="Xóa vĩnh viễn" onClick={() => purge(document)}>
                      <Trash2 />Xóa vĩnh viễn
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!filteredItems.length && <tr><td colSpan={5}><EmptyState message="Thùng rác đang trống." /></td></tr>}
          </tbody>
        </table>
      </section>
    </>
  )
}
