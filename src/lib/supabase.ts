import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

const authStorage = {
  getItem(key: string) {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key)
  },
  setItem(key: string, value: string) {
    const remember = localStorage.getItem('lachong:remember-session') === 'true'
    const target = remember ? localStorage : sessionStorage
    const stale = remember ? sessionStorage : localStorage
    stale.removeItem(key)
    target.setItem(key, value)
  },
  removeItem(key: string) {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export function setRememberSession(remember: boolean) {
  localStorage.setItem('lachong:remember-session', remember ? 'true' : 'false')
}

export function getRememberSession() {
  return localStorage.getItem('lachong:remember-session') !== 'false'
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: authStorage,
  },
})
