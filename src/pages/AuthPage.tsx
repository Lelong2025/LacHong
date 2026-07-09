import { useState } from 'react'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { supabase } from '../lib/supabase'
import './auth.css'

type AuthMode = 'login' | 'register'

type AuthPageProps = {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onStartTransition?: () => void
  onTransitionComplete?: () => void
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
  const [transitionStage, setTransitionStage] = useState<'idle' | 'loading' | 'expanding'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
    onStartTransition && onStartTransition()

    // Đảm bảo hiển thị hiệu ứng lật sách ít nhất 1.8 giây cho đẹp mắt
    const minDelayPromise = new Promise(resolve => setTimeout(resolve, 1800))

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      await minDelayPromise

      // BƯỚC 2: Đăng nhập thành công -> BẮT ĐẦU PHÓNG TO TRÀN VIỀN FULL MÀN HÌNH
      setTransitionStage('expanding')

      // Chờ 850ms cho hiệu ứng scale zoom đạt 60 và phủ kín màn hình
      await new Promise(resolve => setTimeout(resolve, 850))

      // Hoàn thành và tải trang dashboard
      onTransitionComplete && onTransitionComplete()
    } catch (err: unknown) {
      setTransitionStage('idle')
      const msg = err instanceof Error ? err.message : 'Đăng nhập thất bại.'
      if (msg.includes('Invalid login credentials')) {
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

              <button 
                type="submit" 
                className="btn btn-signin"
                disabled={isPendingTransition || registerLoading}
              >
                {registerLoading ? 'Đang xử lý...' : isLogin ? 'Sign In' : 'Sign Up'}
              </button>
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
          <div className="loader">
            <div className="book-body">
              <ul>
                <li><svg fill="currentColor" viewBox="0 0 90 120"><path d="M90,0 L90,120 L11,120 C4.92486775,120 0,115.075132 0,109 L0,11 C0,4.92486775 4.92486775,0 11,0 L90,0 Z M71.5,81 L18.5,81 C17.1192881,81 16,82.1192881 16,83.5 C16,84.8254834 17.0315359,85.9100387 18.3356243,85.9946823 L18.5,86 L71.5,86 C72.8807119,86 74,84.8807119 74,83.5 C74,82.1745166 72.9684641,81.0899613 71.6643757,81.0053177 L71.5,81 Z M71.5,57 L18.5,57 C17.1192881,57 16,58.1192881 16,59.5 C16,60.8254834 17.0315359,61.9100387 18.3356243,61.9946823 L18.5,62 L71.5,62 C72.8807119,62 74,60.8807119 74,59.5 C74,58.1192881 72.8807119,57 71.5,57 Z M71.5,33 L18.5,33 C17.1192881,33 16,34.1192881 16,35.5 C16,36.8254834 17.0315359,37.9100387 18.3356243,37.9946823 L18.5,38 L71.5,38 C72.8807119,38 74,36.8807119 74,35.5 C74,34.1192881 72.8807119,33 71.5,33 Z"></path></svg></li>
                <li><svg fill="currentColor" viewBox="0 0 90 120"><path d="M90,0 L90,120 L11,120 C4.92486775,120 0,115.075132 0,109 L0,11 C0,4.92486775 4.92486775,0 11,0 L90,0 Z M71.5,81 L18.5,81 C17.1192881,81 16,82.1192881 16,83.5 C16,84.8254834 17.0315359,85.9100387 18.3356243,85.9946823 L18.5,86 L71.5,86 C72.8807119,86 74,84.8807119 74,83.5 C74,82.1745166 72.9684641,81.0899613 71.6643757,81.0053177 L71.5,81 Z M71.5,57 L18.5,57 C17.1192881,57 16,58.1192881 16,59.5 C16,60.8254834 17.0315359,61.9100387 18.3356243,61.9946823 L18.5,62 L71.5,62 C72.8807119,62 74,60.8807119 74,59.5 C74,58.1192881 72.8807119,57 71.5,57 Z M71.5,33 L18.5,33 C17.1192881,33 16,34.1192881 16,35.5 C16,36.8254834 17.0315359,37.9100387 18.3356243,37.9946823 L18.5,38 L71.5,38 C72.8807119,38 74,36.8807119 74,35.5 C74,34.1192881 72.8807119,33 71.5,33 Z"></path></svg></li>
                <li><svg fill="currentColor" viewBox="0 0 90 120"><path d="M90,0 L90,120 L11,120 C4.92486775,120 0,115.075132 0,109 L0,11 C0,4.92486775 4.92486775,0 11,0 L90,0 Z M71.5,81 L18.5,81 C17.1192881,81 16,82.1192881 16,83.5 C16,84.8254834 17.0315359,85.9100387 18.3356243,85.9946823 L18.5,86 L71.5,86 C72.8807119,86 74,84.8807119 74,83.5 C74,82.1745166 72.9684641,81.0899613 71.6643757,81.0053177 L71.5,81 Z M71.5,57 L18.5,57 C17.1192881,57 16,58.1192881 16,59.5 C16,60.8254834 17.0315359,61.9100387 18.3356243,61.9946823 L18.5,62 L71.5,62 C72.8807119,62 74,60.8807119 74,59.5 C74,58.1192881 72.8807119,57 71.5,57 Z M71.5,33 L18.5,33 C17.1192881,33 16,34.1192881 16,35.5 C16,36.8254834 17.0315359,37.9100387 18.3356243,37.9946823 L18.5,38 L71.5,38 C72.8807119,38 74,36.8807119 74,35.5 C74,34.1192881 72.8807119,33 71.5,33 Z"></path></svg></li>
              </ul>
            </div>
            <span>Loading...</span>
          </div>
        </div>
      )}
    </div>
  )
}

