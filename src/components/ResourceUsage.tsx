import { Cloud, Database } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'

const backendUrl = import.meta.env.VITE_BACKEND_URL

type UsageValue = {
  usedBytes: number
  limitBytes: number
  remainingBytes: number
  percent: number
  note?: string
  creditDetails?: {
    used: number
    limit: number
    remaining: number
    storageUsedBytes: number
    maxAdditionalStorageBytes: number
  }
}

type UsageSource = UsageValue | { error: string }

type ResourceUsageResponse = {
  supabase: UsageSource
  cloudinary: UsageSource
  updatedAt: string
}

function hasUsage(value: UsageSource | undefined): value is UsageValue {
  return Boolean(value && 'usedBytes' in value)
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value)} ${units[unit]}`
}

function formatCredits(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)
}

function UsageBar({
  label,
  icon,
  value,
  loading,
}: {
  label: string
  icon: ReactNode
  value?: UsageSource
  loading: boolean
}) {
  if (loading && !value) {
    return (
      <article className="resource-usage-card is-loading">
        <div className="resource-usage-heading">{icon}<b>{label}</b></div>
        <div className="resource-usage-skeleton" />
        <small>Đang cập nhật...</small>
      </article>
    )
  }

  if (!value || !hasUsage(value)) {
    return (
      <article className="resource-usage-card has-error">
        <div className="resource-usage-heading">{icon}<b>{label}</b></div>
        <small>Chưa lấy được dung lượng</small>
      </article>
    )
  }

  const percent = Math.min(100, Math.max(0, value.percent))
  const level = percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'normal'
  const credits = value.creditDetails
  const displayLabel = credits ? 'Cloudinary Credits' : label

  return (
    <article className="resource-usage-card">
      <div className="resource-usage-heading">
        {icon}
        <b>{displayLabel}</b>
        <span>{percent.toFixed(percent >= 10 ? 0 : 1)}%</span>
      </div>
      <div
        className="resource-usage-track"
        role="progressbar"
        aria-label={credits ? 'Credits Cloudinary đã sử dụng' : `Dung lượng ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <i className={level} style={{ width: `${percent}%` }} />
      </div>
      {credits ? (
        <>
          <div className="resource-usage-values">
            <small>{formatCredits(credits.used)} / {formatCredits(credits.limit)} credits</small>
            <strong>Còn {formatCredits(credits.remaining)}</strong>
          </div>
          <div className="resource-usage-breakdown">
            <small>Lưu trữ thực tế</small>
            <strong>{formatBytes(credits.storageUsedBytes)}</strong>
          </div>
          <small className="resource-usage-note">
            Tối đa thêm ~{formatBytes(credits.maxAdditionalStorageBytes)} nếu chỉ dùng credits cho lưu trữ
          </small>
        </>
      ) : (
        <>
          <div className="resource-usage-values">
            <small>{formatBytes(value.usedBytes)} / {formatBytes(value.limitBytes)}</small>
            <strong>Còn {formatBytes(value.remainingBytes)}</strong>
          </div>
          {value.note && <small className="resource-usage-note">{value.note}</small>}
        </>
      )}
    </article>
  )
}

export function ResourceUsage() {
  const { session } = useAuth()
  const [usage, setUsage] = useState<ResourceUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = session?.access_token
    if (!token || !backendUrl) {
      setLoading(false)
      return
    }

    let active = true
    const load = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/resource-usage`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) throw new Error('Unable to load resource usage')
        const payload = await response.json() as ResourceUsageResponse
        if (active) setUsage(payload)
      } catch {
        // Keep the last successful values if a background refresh fails.
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    const interval = window.setInterval(() => void load(), 5 * 60 * 1000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [session?.access_token])

  return (
    <section className="resource-usage" aria-label="Dung lượng hệ thống">
      <h2>Dung lượng hệ thống</h2>
      <UsageBar label="Supabase Database" icon={<Database />} value={usage?.supabase} loading={loading} />
      <UsageBar label="Cloudinary" icon={<Cloud />} value={usage?.cloudinary} loading={loading} />
    </section>
  )
}
