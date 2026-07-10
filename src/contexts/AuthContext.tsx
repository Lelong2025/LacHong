import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'

export type Profile = {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'client'
  is_active: boolean
}

type AuthContextType = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  profileLockedOut: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function cleanAuthCallbackUrl() {
  const hash = window.location.hash
  if (!hash.includes('access_token=') && !hash.includes('refresh_token=') && !hash.includes('error=')) return
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}#/`)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLockedOut, setProfileLockedOut] = useState(false)
  // Track previous is_active to only trigger once on transition
  const prevIsActive = useRef<boolean | null>(null)

  useEffect(() => {
    // Fetch session on load
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error && emitSessionExpired(error)) {
        setLoading(false)
        return
      }
      setSession(session)
      setUser(session?.user ?? null)
      if (session) cleanAuthCallbackUrl()
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session) cleanAuthCallbackUrl()
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        prevIsActive.current = null
        setProfileLockedOut(false)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Real-time subscription to profile changes (watches for is_active flipping to false)
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel(`profile-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as Profile
          setProfile(updated)
          // Phát hiện tài khoản vừa bị khóa (chuyển từ active → inactive)
          if (prevIsActive.current === true && updated.is_active === false) {
            setProfileLockedOut(true)
          }
          prevIsActive.current = updated.is_active
        }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [user])

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      
      if (error) {
        if (emitSessionExpired(error)) return
        throw error
      }
      setProfile(data)
      prevIsActive.current = (data as Profile).is_active
    } catch (error) {
      console.error('Error fetching profile:', error)
    } finally {
      setLoading(false)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' })
  }

  const refreshProfile = async () => {
    if (!user) return
    await fetchProfile(user.id)
  }

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, profileLockedOut, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
