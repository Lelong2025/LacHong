import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { NotificationContext, type ConfirmOptions, type NoticeType } from './notification'

type Notice = {
  id: number
  message: string
  type: NoticeType
}

type PendingConfirm = ConfirmOptions & {
  resolve: (value: boolean) => void
}

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id))
  }, [])

  const notify = useCallback((message: string, type: NoticeType = 'info') => {
    const id = nextId.current
    nextId.current += 1
    setNotices((current) => [...current, { id, message, type }].slice(-4))
    window.setTimeout(() => dismiss(id), 4200)
  }, [dismiss])

  const confirmAction = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirm({ ...options, resolve })
    })
  }, [])

  const answerConfirm = (value: boolean) => {
    confirm?.resolve(value)
    setConfirm(null)
  }

  const value = useMemo(() => ({ notify, confirmAction }), [notify, confirmAction])

  return (
    <NotificationContext.Provider value={value}>
      {children}

      <div className="app-toast-stack" aria-live="polite" aria-relevant="additions">
        {notices.map((notice) => {
          const Icon = icons[notice.type]
          return (
            <article key={notice.id} className={`app-toast ${notice.type}`}>
              <Icon />
              <span>{notice.message}</span>
              <button type="button" onClick={() => dismiss(notice.id)} aria-label="Đóng thông báo">
                <X />
              </button>
            </article>
          )
        })}
      </div>

      {confirm && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <section className={confirm.danger ? 'confirm-card danger' : 'confirm-card'}>
            <div className="confirm-icon">
              <AlertTriangle />
            </div>
            <div>
              <h2 id="confirm-title">{confirm.title}</h2>
              <p>{confirm.message}</p>
            </div>
            <div className="confirm-actions">
              <button type="button" className="btn-cancel" onClick={() => answerConfirm(false)}>
                {confirm.cancelText || 'Hủy'}
              </button>
              <button type="button" className={confirm.danger ? 'confirm-danger' : 'btn-submit'} onClick={() => answerConfirm(true)}>
                {confirm.confirmText || 'Đồng ý'}
              </button>
            </div>
          </section>
        </div>
      )}
    </NotificationContext.Provider>
  )
}
