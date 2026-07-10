import { Search, ShieldCheck, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DataViewToggle, type DataViewMode } from '../components/DataViewToggle'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { Profile } from '../types'

export function UsersPage() {
  const [items, setItems] = useState<Profile[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<DataViewMode>('table')
  const forceGrid = useMediaQuery('(max-width: 760px)')

  const load = useCallback(async () => {
    let query = supabase.from('profiles').select('*').order('created_at', { ascending: false })
    if (search) query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`)
    const { data, error } = await query
    if (error) {
      if (emitSessionExpired(error)) return
      setError(error.message)
    }
    else setItems((data || []) as Profile[])
  }, [search])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('users:profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  async function toggleActive(profile: Profile) {
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: !profile.is_active })
      .eq('id', profile.id)

    if (error) {
      if (emitSessionExpired(error)) return
      setError(error.message)
    }
    else setItems((rows) => rows.map((row) => row.id === profile.id ? { ...row, is_active: !row.is_active } : row))
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Quản lý người dùng</h1>
          <p>Tài khoản mới luôn là client; admin có thể khóa hoặc mở lại tài khoản.</p>
        </div>
      </div>
      <section className="toolbar">
        <label>
          <Search />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo email hoặc tên..." />
        </label>
        <DataViewToggle value={viewMode} onChange={setViewMode} forceGrid={forceGrid} />
        <span>{items.length} người dùng</span>
      </section>
      {error && <p className="error">{error}</p>}
      <section className={`table-card data-view-card ${forceGrid || viewMode === 'grid' ? 'is-grid-view' : 'is-table-view'}`}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((profile) => (
              <tr key={profile.id}>
                <td>
                  <b>{profile.full_name || profile.email}</b>
                  <small>{profile.email}</small>
                </td>
                <td><span className="status">{profile.role}</span></td>
                <td><span className={profile.is_active ? 'status approved' : 'status rejected'}>{profile.is_active ? 'Đang hoạt động' : 'Đã khóa'}</span></td>
                <td>
                  {profile.role === 'client' && (
                    <button className={profile.is_active ? 'danger-icon text-button' : 'primary compact'} onClick={() => toggleActive(profile)}>
                      {profile.is_active ? <ShieldOff /> : <ShieldCheck />}
                      {profile.is_active ? 'Khóa' : 'Mở khóa'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={4} className="empty">Chưa có người dùng.</td></tr>}
          </tbody>
        </table>
        <div className="data-grid">
          {items.map((profile) => (
            <article className="data-card" key={profile.id}>
              <div className="data-card-title-row">
                <span className="status">{profile.role}</span>
                <span className={profile.is_active ? 'status approved' : 'status rejected'}>{profile.is_active ? 'Đang hoạt động' : 'Đã khóa'}</span>
              </div>
              <div className="data-card-main text-only">
                <b>{profile.full_name || profile.email}</b>
                <small>{profile.email}</small>
              </div>
              {profile.role === 'client' && (
                <div className="data-card-actions">
                  <button className={profile.is_active ? 'danger-icon text-button' : 'primary compact'} onClick={() => toggleActive(profile)}>
                    {profile.is_active ? <ShieldOff /> : <ShieldCheck />}
                    {profile.is_active ? 'Khóa' : 'Mở khóa'}
                  </button>
                </div>
              )}
            </article>
          ))}
          {!items.length && <div className="empty">Chưa có người dùng.</div>}
        </div>
      </section>
    </>
  )
}
