import { useContext } from 'react'
import { NotificationContext } from './notification'

export function useNotifier() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifier must be used inside NotificationProvider')
  return context
}
