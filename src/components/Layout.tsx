import { BarChart3, FileText, LayoutDashboard, LogOut, Menu, Settings, Trash2, Users, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { NotificationBell } from './NotificationBell'
import { ThemeSwitch } from './ThemeSwitch'
import { ResourceUsage } from './ResourceUsage'

const clientNav = [
  { label: 'Quản lý', items: [['/', 'Tổng quan', LayoutDashboard], ['/documents', 'Hồ sơ', FileText], ['/statistics', 'Thống kê', BarChart3]] },
  { label: 'Hệ thống', items: [['/trash', 'Thùng rác', Trash2], ['/settings', 'Cài đặt', Settings]] },
] as const

const adminNav = [
  { label: 'Quản lý', items: [['/', 'Tổng quan', LayoutDashboard], ['/documents', 'Hồ sơ', FileText], ['/statistics', 'Thống kê', BarChart3], ['/users', 'Quản lý người dùng', Users]] },
  { label: 'Hệ thống', items: [['/trash', 'Thùng rác', Trash2], ['/settings', 'Cài đặt', Settings]] },
] as const

export function Layout({ children, theme, onToggleTheme }: { children: ReactNode; theme: 'light' | 'dark'; onToggleTheme: () => void }) {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const nav = profile?.role === 'admin' ? adminNav : clientNav

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div className="shell">
    <aside className={open ? 'sidebar open' : 'sidebar'}>
      <div className="sidebar-title">
        <span className="sidebar-brand-mark">LH</span>
        <span className="sidebar-brand-copy"><strong>HỆ THỐNG QUẢN LÝ</strong><small>Trung Tâm Nghiên Cứu Khoa Học &amp; Ứng Dụng</small></span>
        <button className="mobile-close" onClick={() => setOpen(false)} aria-label="Đóng menu"><X /></button>
      </div>
      <nav>
        {nav.map(group => <section className="nav-group" key={group.label}>
          <span className="nav-group-label">{group.label}</span>
          {group.items.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}><Icon /><span>{label}</span></NavLink>)}
        </section>)}
      </nav>
      {profile?.role === 'admin' && <ResourceUsage />}
    </aside>
    {open && <button type="button" className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="Đóng menu" />}
    <div className="app"><header><button className="menu-button" onClick={() => setOpen(true)} aria-label="Mở menu" aria-expanded={open}><Menu /></button><b className="header-title"><span className="header-title-full">TRUNG TÂM NGHIÊN CỨU KHOA HỌC &amp; ỨNG DỤNG</span><span className="header-title-short">TTNCKH&amp;UD</span></b><div className="header-actions"><ThemeSwitch checked={theme === 'dark'} onChange={onToggleTheme} className="header-theme-switch" /><NotificationBell /><span className="user-chip">{profile?.full_name || profile?.email}<small>{profile?.role}</small></span><button title="Đăng xuất" onClick={signOut}><LogOut /></button></div></header><main className="content">{children}</main><footer>© 2026 Trung Tâm Nghiên Cứu Khoa Học &amp; Ứng Dụng · Hệ thống quản lý hồ sơ</footer></div>
  </div>
}
