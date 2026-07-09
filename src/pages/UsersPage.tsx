import { Search, ShieldCheck, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'
import type { Profile } from '../types'

export function UsersPage() {
  const [items, setItems] = useState<Profile[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

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
        <span>{items.length} người dùng</span>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="table-card">
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
      </section>
    </>
  )
}
