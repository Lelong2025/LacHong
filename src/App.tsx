import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Layout } from './components/Layout'
import { useAuth, type Profile } from './contexts/AuthContext'
import type { Session } from '@supabase/supabase-js'
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
  const [delayedSession, setDelayedSession] = useState<Session | null>(null)
  const [delayedProfile, setDelayedProfile] = useState<Profile | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)

  useEffect(() => {
    if (!isTransitioning) {
      setDelayedSession(session)
      setDelayedProfile(profile)
    }
  }, [session, profile, isTransitioning])

  if (loading) {
    return <div className="splash">Đang tải hệ thống...</div>
  }

  if (!delayedSession) {
    return (
      <AuthPage 
        theme={theme} 
        onToggleTheme={onToggleTheme} 
        onStartTransition={() => setIsTransitioning(true)}
        onTransitionComplete={() => {
          setIsTransitioning(false)
          setDelayedSession(session)
          setDelayedProfile(profile)
        }}
      />
    )
  }

  if (delayedProfile && !delayedProfile.is_active) {
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
        {delayedProfile?.role === 'admin' && <Route path="/users" element={<UsersPage />} />}
        {delayedProfile?.role === 'admin' && <Route path="/activity" element={<ActivityPage />} />}
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
