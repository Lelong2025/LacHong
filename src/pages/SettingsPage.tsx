import { KeyRound, Mail, Save, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNotifier } from '../contexts/useNotifier'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'

const backendUrl = import.meta.env.VITE_BACKEND_URL

export function SettingsPage() {
  const { user, profile, refreshProfile } = useAuth()
  const { notify } = useNotifier()
  const [email, setEmail] = useState(user?.email || profile?.email || '')
  const [fullName, setFullName] = useState(profile?.full_name || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  async function callBackend(path: string, body: Record<string, unknown>) {
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

    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) {
      const message = payload.error || 'Backend xử lý thất bại.'
      if (response.status === 401) emitSessionExpired(message)
      throw new Error(message)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    const nextEmail = email.trim().toLowerCase()
    const nextFullName = fullName.trim()

    if (nextFullName === profile?.full_name && nextEmail === user.email) {
      notify('Không có thay đổi để cập nhật', 'info')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      notify('Email không hợp lệ.', 'error')
      return
    }

    if (nextFullName.length > 50) {
      notify('Tên hiển thị không được vượt quá 50 ký tự', 'error')
      return
    }

    setSavingProfile(true)
    try {
      if (nextEmail !== user.email) {
        const { error } = await supabase.auth.updateUser({ email: nextEmail })
        if (error) throw error
      }

      await callBackend('/api/update-profile-settings', {
        email: nextEmail,
        fullName: nextFullName,
      })

      await refreshProfile()
      notify(nextEmail !== user.email
        ? 'Đã cập nhật. Nếu Supabase yêu cầu xác nhận, hãy kiểm tra email mới.'
        : 'Đã lưu thông tin tài khoản.',
        'success',
      )
    } catch (error) {
      if (emitSessionExpired(error)) return
      notify(error instanceof Error ? error.message : 'Không thể cập nhật thông tin.', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 6) {
      notify('Mật khẩu mới cần ít nhất 6 ký tự.', 'error')
      return
    }

    if (password !== confirmPassword) {
      notify('Mật khẩu xác nhận không khớp.', 'error')
      return
    }

    setSavingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setPassword('')
      setConfirmPassword('')
      notify('Đã đổi mật khẩu.', 'success')
    } catch (error) {
      if (emitSessionExpired(error)) return
      notify(error instanceof Error ? error.message : 'Không thể đổi mật khẩu.', 'error')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Cài đặt tài khoản</h1>
          <p>Quản lý email Supabase, tên hiển thị và mật khẩu đăng nhập.</p>
        </div>
      </div>

      <section className="settings-grid">
        <form className="settings-card" onSubmit={saveProfile}>
          <div className="settings-card-title">
            <Mail />
            <div>
              <h2>Email và tên hiển thị</h2>
              <p>Email này dùng cho tài khoản Supabase và hiển thị trong hệ thống.</p>
            </div>
          </div>

          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email@example.com"
              required
            />
          </label>

          <label>
            Tên hiển thị
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Tên hiển thị"
            />
          </label>

          <button className="primary" disabled={savingProfile}>
            <Save />{savingProfile ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </form>

        <form className="settings-card" onSubmit={changePassword}>
          <div className="settings-card-title">
            <KeyRound />
            <div>
              <h2>Đổi mật khẩu</h2>
              <p>Mật khẩu mới sẽ được áp dụng cho lần đăng nhập tiếp theo.</p>
            </div>
          </div>

          <label>
            Mật khẩu mới
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Tối thiểu 6 ký tự"
              autoComplete="new-password"
            />
          </label>

          <label>
            Nhập lại mật khẩu mới
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Nhập lại mật khẩu mới"
              autoComplete="new-password"
            />
          </label>

          <button className="primary" disabled={savingPassword}>
            <UserRound />{savingPassword ? 'Đang đổi...' : 'Đổi mật khẩu'}
          </button>
        </form>
      </section>
    </>
  )
}
