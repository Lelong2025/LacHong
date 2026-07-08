import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import AuthPage from './pages/AuthPage'

const Dashboard = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', color: '#1a56a0', fontSize: '1.4rem', flexDirection: 'column', gap: 12 }}>
    <span style={{ fontSize: '3rem' }}>🎉</span>
    Dashboard (Coming soon)
  </div>
)

function Protected() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', color: '#1a56a0', fontSize: '1.1rem' }}>
        Đang tải hệ thống…
      </div>
    )
  }

  if (!session) return <AuthPage />

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Protected />
    </HashRouter>
  )
}
