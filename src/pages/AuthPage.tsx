import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BookLoader } from '../components/BookLoader'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { getRememberSession, setRememberSession, supabase } from '../lib/supabase'
import './auth.css'

type AuthMode = 'login' | 'register'

type AuthPageProps = {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onStartTransition?: () => void
  onTransitionComplete?: (session: Session) => void
}

function getAuthCallbackUrl(next?: string) {
  const basePath = import.meta.env.BASE_URL || '/'
  const normalizedBase = basePath.startsWith('/') ? basePath : `/${basePath}`
  const redirectUrl = new URL(normalizedBase, window.location.origin)
  if (next) redirectUrl.searchParams.set('next', next)
  return redirectUrl.toString()
}

export default function AuthPage({ 
  theme, 
  onToggleTheme, 
  onStartTransition, 
  onTransitionComplete 
}: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [showPassword, setShowPassword] = useState(false)
  const [registerLoading, setRegisterLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [transitionStage, setTransitionStage] = useState<'idle' | 'loading' | 'expanding'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [remember, setRemember] = useState(getRememberSession)

  // Form Fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode)
    setError(null)
    setSuccess(null)
    setEmail('')
    setPassword('')
    setFullName('')
    setShowPassword(false)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    // BƯỚC 1: Quét mây ẩn form trong khuôn khổ của Card
    setTransitionStage('loading')
    onStartTransition?.()

    // Giữ loader sách theo nhịp mẫu HTML trước khi bung vào dashboard.
    const minDelayPromise = new Promise(resolve => setTimeout(resolve, 3000))

    try {
      setRememberSession(remember)
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password })
      if (loginError) throw loginError
      if (!loginData.session) throw new Error('Không lấy được phiên đăng nhập.')

      // Kiểm tra tài khoản có đang bị khóa không
      const { data: profileData } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', loginData.user.id)
        .single()

      if (profileData && !profileData.is_active) {
        // Đăng xuất ngay lập tức nếu tài khoản bị khóa
        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('ACCOUNT_LOCKED')
      }

      await minDelayPromise

      // BƯỚC 2: Đăng nhập thành công -> BẮT ĐẦU PHÓNG TO TRÀN VIỀN FULL MÀN HÌNH
      setTransitionStage('expanding')

      // Chờ 850ms cho hiệu ứng scale zoom đạt 60 và phủ kín màn hình
      await new Promise(resolve => setTimeout(resolve, 850))

      // Hoàn thành và tải trang dashboard
      onTransitionComplete?.(loginData.session)
    } catch (err: unknown) {
      setTransitionStage('idle')
      const msg = err instanceof Error ? err.message : 'Đăng nhập thất bại.'
      if (msg === 'ACCOUNT_LOCKED') {
        setError('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.')
      } else if (msg.includes('Invalid login credentials')) {
        setError('Email hoặc mật khẩu không chính xác.')
      } else if (msg.includes('Email not confirmed')) {
        setError('Vui lòng xác minh email trước khi đăng nhập.')
      } else {
        setError(msg)
      }
    }
  }


  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!fullName.trim()) {
      setError('Vui lòng nhập họ tên.')
      return
    }
    setRegisterLoading(true)
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: getAuthCallbackUrl(),
        },
      })
      if (error) throw error
      setSuccess('Đăng ký thành công! Vui lòng kiểm tra email để xác minh tài khoản.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Đăng ký thất bại.'
      if (msg.includes('already registered')) {
        setError('Email này đã được đăng ký.')
      } else {
        setError(msg)
      }
    } finally {
      setRegisterLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    setError(null)
    setSuccess(null)
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Nhập email hợp lệ trước khi dùng quên mật khẩu.')
      return
    }

    setResetLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getAuthCallbackUrl(),
      })
      if (error) throw error
      setSuccess('Đã gửi email đặt lại mật khẩu. Vui lòng kiểm tra hộp thư.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không gửi được email đặt lại mật khẩu.')
    } finally {
      setResetLoading(false)
    }
  }

  const isLogin = mode === 'login'
  const isPendingTransition = transitionStage !== 'idle'

  return (
    <div className={`auth-wrapper ${isLogin ? 'login' : 'register'} ${transitionStage === 'loading' ? 'stage-loading' : ''} ${transitionStage === 'expanding' ? 'stage-expand' : ''}`}>
      <ThemeSwitch checked={theme === 'dark'} onChange={onToggleTheme} className="auth-theme-switch" />
      <div className="login-card">
        
        {/* --- Background SVG Clouds Container (Slides left and right) --- */}
        <div className={`bg-svg-container ${isLogin ? 'login' : 'register'}`}>
          
          {/* SVG 1: LOGIN (White cloud on the right) */}
          <svg className="bg-svg-item" viewBox="0 0 1000 562" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="white-cloud-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="-8" dy="6" stdDeviation="8" floodOpacity="0.3"/>
              </filter>
              <filter id="blue-cloud-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="6" dy="6" stdDeviation="9" floodOpacity="0.25"/>
              </filter>
            </defs>
            
            <rect width="1000" height="562" fill="#164877"/>
            
            <g className="blue-layer" filter="url(#blue-cloud-shadow)" fill="#113659">
              <circle cx="100" cy="20" r="140" />
              <circle cx="260" cy="-10" r="120" />
              <circle cx="380" cy="-40" r="100" />
            </g>
            
            <g className="blue-layer" filter="url(#blue-cloud-shadow)" fill="#133f67">
              <circle cx="50" cy="60" r="130" />
              <circle cx="190" cy="40" r="120" />
              <circle cx="320" cy="10" r="110" />
            </g>
            
            <g className="blue-layer" filter="url(#blue-cloud-shadow)" fill="#184e82">
              <circle cx="-20" cy="420" r="150" />
              <circle cx="120" cy="490" r="140" />
              <circle cx="280" cy="540" r="120" />
            </g>
            <g className="blue-layer" filter="url(#blue-cloud-shadow)" fill="#1b568f">
              <circle cx="60" cy="510" r="130" />
              <circle cx="210" cy="560" r="120" />
            </g>
            
            <g className="white-layer" filter="url(#white-cloud-shadow)" fill="#ffffff">
              <polygon points="1000,0 720,0 620,150 530,290 420,470 420,562 1000,562" />
              <circle cx="720" cy="30" r="90" />
              <circle cx="620" cy="150" r="100" />
              <circle cx="530" cy="290" r="120" />
              <circle cx="420" cy="470" r="160" />
            </g>
          </svg>

          {/* SVG 2: REGISTER (Mirrored: White cloud on the left) */}
          <svg className="bg-svg-item" viewBox="0 0 1000 562" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="white-cloud-shadow-reg" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="8" dy="6" stdDeviation="8" floodOpacity="0.3"/>
              </filter>
              <filter id="blue-cloud-shadow-reg" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="-6" dy="6" stdDeviation="9" floodOpacity="0.25"/>
              </filter>
            </defs>
            
            <rect width="1000" height="562" fill="#164877"/>
            
            <g className="blue-layer" filter="url(#blue-cloud-shadow-reg)" fill="#113659">
              <circle cx="900" cy="20" r="140" />
              <circle cx="740" cy="-10" r="120" />
              <circle cx="620" cy="-40" r="100" />
            </g>
            
            <g className="blue-layer" filter="url(#blue-cloud-shadow-reg)" fill="#133f67">
              <circle cx="950" cy="60" r="130" />
              <circle cx="810" cy="40" r="120" />
              <circle cx="680" cy="10" r="110" />
            </g>
            
            <g className="blue-layer" filter="url(#blue-cloud-shadow-reg)" fill="#184e82">
              <circle cx="1020" cy="420" r="150" />
              <circle cx="880" cy="490" r="140" />
              <circle cx="740" cy="540" r="120" />
            </g>
            <g className="blue-layer" filter="url(#blue-cloud-shadow-reg)" fill="#1b568f">
              <circle cx="940" cy="510" r="130" />
              <circle cx="810" cy="560" r="120" />
            </g>
            
            <g className="white-layer" filter="url(#white-cloud-shadow-reg)" fill="#ffffff">
              <polygon points="0,0 280,0 380,150 470,290 580,470 580,562 0,562" />
              <circle cx="280" cy="30" r="90" />
              <circle cx="380" cy="150" r="100" />
              <circle cx="470" cy="290" r="120" />
              <circle cx="580" cy="470" r="160" />
            </g>
          </svg>

        </div>

        {/* --- Brand / Logo Container --- */}
        <div className={`brand-logo-container ${isLogin ? 'login' : 'register'}`}>
          <img src="/LacHong/Logo.png" alt="LHU Logo" className="brand-logo-img" />
        </div>

        {/* --- Form Container --- */}
        <div className={`form-container ${isLogin ? 'login' : 'register'}`}>
          <h1>{isLogin ? 'LOGIN' : 'REGISTER'}</h1>

          {error && <div className="alert-box alert-error">{error}</div>}
          {success && <div className="alert-box alert-success">{success}</div>}

          {!success && (
            <form onSubmit={isLogin ? handleLogin : handleRegister}>
              {/* Full Name field (Register only) */}
              {!isLogin && (
                <div className="input-box">
                  <i className="fa-regular fa-user"></i>
                  <input 
                    type="text" 
                    placeholder="Username" 
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    required
                    disabled={registerLoading}
                  />
                </div>
              )}

              {/* Email field */}
              <div className="input-box">
                <i className="fa-regular fa-envelope"></i>
                <input 
                  type="email" 
                  placeholder="Email" 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={isPendingTransition || registerLoading}
                />
              </div>

              {/* Password field */}
              <div className="input-box">
                <i className="fa-solid fa-lock"></i>
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="Password" 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={isPendingTransition || registerLoading}
                />
                <i 
                  className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} 
                  onClick={() => !isPendingTransition && !registerLoading && setShowPassword(!showPassword)}
                ></i>
              </div>

              {isLogin && (
                <label className="remember-row">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    disabled={isPendingTransition || registerLoading}
                  />
                  <span>Remember me</span>
                </label>
              )}

              <button 
                type="submit" 
                className="btn btn-signin"
                disabled={isPendingTransition || registerLoading || resetLoading}
              >
                {registerLoading || resetLoading ? 'Đang xử lý...' : isLogin ? 'Sign In' : 'Sign Up'}
              </button>
              {isLogin && (
                <button
                  type="button"
                  className="forgot-password-link"
                  onClick={handleForgotPassword}
                  disabled={isPendingTransition || registerLoading || resetLoading}
                >
                  Quên mật khẩu?
                </button>
              )}
            </form>
          )}

          <div className="or-divider">
            <span>Or</span>
          </div>

          <button 
            type="button" 
            className="btn btn-signup"
            onClick={() => !isPendingTransition && !registerLoading && switchMode(isLogin ? 'register' : 'login')}
            disabled={isPendingTransition || registerLoading}
          >
            {isLogin ? 'Sign Up' : 'Sign In'}
          </button>
        </div>

      </div>

      {/* ================= LOADING OVERLAY ================= */}
      {isPendingTransition && (
        <div className="loading-overlay">
          <BookLoader />
        </div>
      )}
    </div>
  )
}
