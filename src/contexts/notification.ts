import { createContext } from 'react'

export type NoticeType = 'success' | 'error' | 'info' | 'warning'

export type ConfirmOptions = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export type NotificationContextValue = {
  notify: (message: string, type?: NoticeType) => void
  confirmAction: (options: ConfirmOptions) => Promise<boolean>
}

export const NotificationContext = createContext<NotificationContextValue | null>(null)
