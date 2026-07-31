import { LockKeyhole, MoreVertical, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [showFilters, setShowFilters] = useState(false)
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
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

  const filteredItems = useMemo(() => items.filter(profile =>
    (!roleFilter || profile.role === roleFilter) &&
    (!statusFilter || (statusFilter === 'active' ? profile.is_active : !profile.is_active))
  ), [items, roleFilter, statusFilter])

  const initials = (profile: Profile) => {
    const source = profile.full_name?.trim() || profile.email
    const parts = source.split(/\s+/).filter(Boolean)
    return (parts.length > 1 ? `${parts[parts.length - 2][0]}${parts[parts.length - 1][0]}` : source.slice(0, 2)).toLocaleUpperCase('vi-VN')
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Quản lý người dùng</h1>
          <p>Tài khoản mới luôn là client; admin có thể khóa hoặc mở lại tài khoản.</p>
        </div>
      </div>
      <section className="toolbar users-toolbar">
        <label>
          <Search />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo email hoặc tên nhân viên..." />
        </label>
        <div className="users-toolbar-actions">
          <DataViewToggle value={viewMode} onChange={setViewMode} forceGrid={forceGrid} />
          <button type="button" className={`users-filter-button ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(current => !current)}>
            <SlidersHorizontal /> Bộ lọc
          </button>
          <span>{filteredItems.length} người dùng</span>
        </div>
        {showFilters && (
          <div className="users-filter-panel">
            <select value={roleFilter} onChange={event => setRoleFilter(event.target.value)} aria-label="Lọc theo vai trò">
              <option value="">Tất cả vai trò</option>
              <option value="admin">Admin</option>
              <option value="client">Client</option>
            </select>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Lọc theo trạng thái">
              <option value="">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="locked">Đã khóa</option>
            </select>
          </div>
        )}
      </section>
      {error && <p className="error">{error}</p>}
      <section className={`table-card data-view-card ${forceGrid || viewMode === 'grid' ? 'is-grid-view' : 'is-table-view'}`}>
        <table>
          <thead>
            <tr>
              <th>Email &amp; họ tên</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((profile) => (
              <tr key={profile.id}>
                <td>
                  <div className="user-identity">
                    <span className="user-avatar">{initials(profile)}</span>
                    <span>
                      <b>{profile.full_name || profile.email}</b>
                      <small>{profile.email}</small>
                    </span>
                  </div>
                </td>
                <td><span className={`user-role ${profile.role}`}>{profile.role}</span></td>
                <td><span className={`user-state ${profile.is_active ? 'active' : 'locked'}`}><i />{profile.is_active ? 'Đang hoạt động' : 'Đã khóa'}</span></td>
                <td className="user-actions">
                  {profile.role === 'client' && (
                    <button className={profile.is_active ? 'danger-icon text-button' : 'primary compact'} onClick={() => toggleActive(profile)}>
                      {profile.is_active ? <LockKeyhole /> : <ShieldCheck />}
                      {profile.is_active ? 'Khóa' : 'Mở khóa'}
                    </button>
                  )}
                  <button type="button" className="user-more-button" aria-label={`Thêm thao tác cho ${profile.full_name || profile.email}`}><MoreVertical /></button>
                </td>
              </tr>
            ))}
            {!filteredItems.length && <tr><td colSpan={4} className="empty">Chưa có người dùng.</td></tr>}
          </tbody>
        </table>
        <div className="data-grid">
          {filteredItems.map((profile) => (
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
                    {profile.is_active ? <LockKeyhole /> : <ShieldCheck />}
                    {profile.is_active ? 'Khóa' : 'Mở khóa'}
                  </button>
                </div>
              )}
            </article>
          ))}
          {!filteredItems.length && <div className="empty">Chưa có người dùng.</div>}
        </div>
      </section>
    </>
  )
}
