import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { Layout } from './components/Layout'
import { BookLoader } from './components/BookLoader'
import { useAuth, type Profile } from './contexts/AuthContext'
import { NotificationProvider } from './contexts/NotificationContext'
import { useNotifier } from './contexts/useNotifier'
import type { Session } from '@supabase/supabase-js'
import AuthPage from './pages/AuthPage'
import { DashboardPage } from './pages/DashboardPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatisticsPage } from './pages/StatisticsPage'
import { TrashPage } from './pages/TrashPage'
import { UsersPage } from './pages/UsersPage'
import './App.css'

type Theme = 'light' | 'dark'
const lockedAccountIllustration = `${import.meta.env.BASE_URL}locked-account.svg`

function getInitialTheme(): Theme {
  const saved = localStorage.getItem('theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function Protected({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const { session, loading, profile, profileLockedOut, signOut } = useAuth()
  const { notify } = useNotifier()
  const [delayedSession, setDelayedSession] = useState<Session | null>(null)
  const [delayedProfile, setDelayedProfile] = useState<Profile | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [lockoutCountdown, setLockoutCountdown] = useState(4)
  const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isTransitioning) {
      setDelayedSession(session)
      setDelayedProfile(profile)
    }
  }, [session, profile, isTransitioning])

  // Khi phát hiện tài khoản bị khóa real-time → đếm ngược rồi đăng xuất
  useEffect(() => {
    if (!profileLockedOut) return

    setLockoutCountdown(4)
    lockoutTimer.current = setInterval(() => {
      setLockoutCountdown(prev => {
        if (prev <= 1) {
          clearInterval(lockoutTimer.current!)
          void signOut()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (lockoutTimer.current) clearInterval(lockoutTimer.current)
    }
  }, [profileLockedOut, signOut])

  useEffect(() => {
    let handling = false
    const onSessionExpired = () => {
      if (handling) return
      handling = true
      notify('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'warning')
      void signOut().finally(() => {
        window.setTimeout(() => { handling = false }, 1000)
      })
    }

    window.addEventListener('lachong:session-expired', onSessionExpired)
    return () => window.removeEventListener('lachong:session-expired', onSessionExpired)
  }, [notify, signOut])

  if (loading) {
    return (
      <div className="splash splash-loader">
        <BookLoader label="Đang tải hệ thống..." />
      </div>
    )
  }

  if (!delayedSession) {
    return (
      <AuthPage
        theme={theme}
        onToggleTheme={onToggleTheme}
        onStartTransition={() => setIsTransitioning(true)}
        onTransitionCancel={() => setIsTransitioning(false)}
        onTransitionComplete={(signedInSession) => {
          setIsTransitioning(false)
          setDelayedSession(signedInSession)
          setDelayedProfile(profile)
        }}
      />
    )
  }

  // Tài khoản đã bị khóa từ trước khi đăng nhập
  if (delayedProfile && !delayedProfile.is_active && !profileLockedOut) {
    return (
      <div className="splash inactive-account">
        <section className="inactive-account-card">
          <img src={lockedAccountIllustration} alt="" className="inactive-account-illustration" />
          <h1>Tài khoản đang bị khóa</h1>
          <p>Vui lòng liên hệ quản trị viên để được hỗ trợ.</p>
          <button onClick={() => void signOut()} className="primary">
            Đăng xuất
          </button>
        </section>
      </div>
    )
  }

  return (
    <Layout theme={theme} onToggleTheme={onToggleTheme}>
      {/* === BANNER KHÓA TÀI KHOẢN REAL-TIME === */}
      {profileLockedOut && (
        <div className="lockout-banner">
          <div className="lockout-banner-inner">
            <span className="lockout-icon">🔒</span>
            <div className="lockout-text">
              <strong>Tài khoản của bạn đã bị khóa</strong>
              <span>Vui lòng liên hệ quản trị viên. Hệ thống sẽ tự động đăng xuất sau {lockoutCountdown}s...</span>
            </div>
            <button
              className="lockout-signout-btn"
              onClick={() => {
                if (lockoutTimer.current) clearInterval(lockoutTimer.current)
                void signOut()
              }}
            >
              Đăng xuất ngay
            </button>
          </div>
        </div>
      )}
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/:type" element={<Navigate to="/documents" replace />} />
        <Route path="/archive" element={<Navigate to="/" replace />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/statistics" element={<StatisticsPage />} />
        {delayedProfile?.role === 'admin' && <Route path="/users" element={<UsersPage />} />}
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
    <NotificationProvider>
      <HashRouter>
        <Protected theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
      </HashRouter>
    </NotificationProvider>
  )
}
