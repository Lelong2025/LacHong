import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Layout } from './components/Layout'
import { useAuth } from './contexts/AuthContext'
import AuthPage from './pages/AuthPage'
import { ActivityPage } from './pages/ActivityPage'
import { DashboardPage } from './pages/DashboardPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { UsersPage } from './pages/UsersPage'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const saved = localStorage.getItem('theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function Protected({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const { session, loading, profile } = useAuth()

  if (loading) {
    return <div className="splash">Đang tải hệ thống...</div>
  }

  if (!session) return <AuthPage theme={theme} onToggleTheme={onToggleTheme} />

  if (profile && !profile.is_active) {
    return (
      <div className="splash inactive-account">
        <h1>Tài khoản đang bị khóa</h1>
        <p>Vui lòng liên hệ quản trị viên để được hỗ trợ.</p>
      </div>
    )
  }

  return (
    <Layout theme={theme} onToggleTheme={onToggleTheme}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/:type" element={<Navigate to="/documents" replace />} />
        <Route path="/archive" element={<PlaceholderPage title="Lưu trữ" />} />
        <Route path="/statistics" element={<PlaceholderPage title="Thống kê" />} />
        {profile?.role === 'admin' && <Route path="/users" element={<UsersPage />} />}
        {profile?.role === 'admin' && <Route path="/activity" element={<ActivityPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  return (
    <HashRouter>
      <Protected theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
    </HashRouter>
  )
}
