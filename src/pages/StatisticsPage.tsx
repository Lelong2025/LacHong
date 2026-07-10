import { FileText, Hash, CheckCircle2, Send, Clock3, Stamp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { EmptyState } from '../components/EmptyState'
import { DataViewToggle, type DataViewMode } from '../components/DataViewToggle'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { DocumentRow } from '../types'

const typeList = [
  { key: 'totrinh', label: 'Tờ trình', icon: Send },
  { key: 'quyetdinh', label: 'Quyết định', icon: Stamp },
  { key: 'khenthuong', label: 'Khen thưởng', icon: CheckCircle2 },
  { key: 'baocao', label: 'Báo cáo', icon: FileText },
  { key: 'kehoach', label: 'Kế hoạch', icon: Clock3 },
  { key: 'banhanh', label: 'Ban hành', icon: Hash },
]

const chartColors = ['#164877', '#087b38', '#9a6200', '#7c3aed', '#0f766e', '#b42318']

function assigneeDisplayNames(value: string | null) {
  if (!value) return ['Chưa gán']
  const names = value
    .split(',')
    .map(item => item.trim().replace(/\s*\([^)]*@[^)]*\)/g, ''))
    .filter(Boolean)
  return names.length ? names : ['Chưa gán']
}

export function StatisticsPage() {
  const { profile, user } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [error, setError] = useState('')
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()))
  const [viewMode, setViewMode] = useState<DataViewMode>('table')
  const forceGrid = useMediaQuery('(max-width: 760px)')

  const load = useCallback(async () => {
    let query = supabase
      .from('documents')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(500)

    const { data, error } = await query
    if (error) {
      if (emitSessionExpired(error)) return
      setError(error.message)
    }
    else setDocuments((data || []) as DocumentRow[])
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel(`stats-docs:${user?.id ?? 'anonymous'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_shares' }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load, user?.id])

  const availableYears = useMemo(() => {
    const years = new Set(documents.map(doc => doc.document_year || new Date(doc.created_at).getFullYear()))
    years.add(new Date().getFullYear())
    return Array.from(years).sort((a, b) => b - a)
  }, [documents])

  const scopedDocuments = useMemo(() => documents.filter(doc => {
    if (!yearFilter) return true
    return (doc.document_year || new Date(doc.created_at).getFullYear()) === Number(yearFilter)
  }), [documents, yearFilter])

  const typeStats = useMemo(() =>
    typeList.map(({ key, label, icon }) => {
      const docs = scopedDocuments.filter(d => d.type === key)
      return {
        key, label, icon,
        total: docs.length,
      }
    }),
    [scopedDocuments]
  )

  const assigneeStats = useMemo(() => {
    const counts = scopedDocuments.reduce<Record<string, number>>((acc, doc) => {
      for (const key of assigneeDisplayNames(doc.assignee_name)) {
        acc[key] = (acc[key] ?? 0) + 1
      }
      return acc
    }, {})
    return Object.entries(counts).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10)
  }, [scopedDocuments])

  const pieGradient = useMemo(() => {
    let start = 0
    const total = Math.max(scopedDocuments.length, 1)
    return `conic-gradient(${typeStats.map((item, index) => {
      const end = start + (item.total / total) * 100
      const segment = `${chartColors[index % chartColors.length]} ${start}% ${end}%`
      start = end
      return segment
    }).join(', ')})`
  }, [scopedDocuments.length, typeStats])
  const maxAssigneeTotal = Math.max(...assigneeStats.map(item => item.total), 1)

  if (!documents.length) {
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Thống kê hồ sơ</h1>
            <p>Phân tích hồ sơ theo loại và trạng thái{isAdmin ? ' toàn hệ thống' : ' của bạn'}.</p>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <section className="table-card" style={{ padding: 0 }}>
          <EmptyState message="Chưa có dữ liệu thống kê." />
        </section>
      </>
    )
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Thống kê hồ sơ</h1>
          <p>Phân tích hồ sơ theo loại và trạng thái{isAdmin ? ' toàn hệ thống' : ' của bạn'}.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="toolbar chart-filter">
        <span>Thống kê theo năm</span>
        <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
          <option value="">Tất cả năm</option>
          {availableYears.map(year => <option key={year} value={year}>{year}</option>)}
        </select>
      </section>

      {/* Cards theo loại hồ sơ */}
      <section className="metric-grid" style={{ marginBottom: '1.5rem' }}>
        {typeList.map(({ key, label, icon: Icon }) => {
          const count = scopedDocuments.filter(d => d.type === key).length
          return (
            <article className="metric-card" key={key} style={count === 0 ? { opacity: 0.5 } : {}}>
              <Icon />
              <span>{label}</span>
              <b>{count}</b>
            </article>
          )
        })}
      </section>

      <section className="chart-grid">
        <article className="chart-card">
          <h2>Số liệu theo loại hồ sơ</h2>
          <div className="pie-chart" style={{ background: pieGradient }} />
          <div className="chart-legend">
            {typeStats.map((item, index) => (
              <span key={item.key}><i style={{ background: chartColors[index % chartColors.length] }} />{item.label}: {item.total}</span>
            ))}
          </div>
        </article>
        <article className="chart-card">
          <h2>Số liệu theo người thực hiện</h2>
          <div className="bar-chart">
            {assigneeStats.map(item => (
              <div className="bar-row" key={item.name}>
                <span>{item.name}</span>
                <div><i style={{ width: `${Math.max((item.total / maxAssigneeTotal) * 100, 4)}%` }} /></div>
                <b>{item.total}</b>
              </div>
            ))}
            {!assigneeStats.length && <EmptyState message="Chưa có dữ liệu người thực hiện." />}
          </div>
        </article>
      </section>

      {/* Bảng thống kê chi tiết theo loại */}
      <section className={`table-card data-view-card ${forceGrid || viewMode === 'grid' ? 'is-grid-view' : 'is-table-view'}`} style={{ marginBottom: '1.25rem' }}>
        <div className="table-card-header">
          <strong style={{ fontSize: '.9rem' }}>Chi tiết theo loại hồ sơ</strong>
          <DataViewToggle value={viewMode} onChange={setViewMode} forceGrid={forceGrid} />
        </div>
        <table>
          <thead>
            <tr>
              <th>Loại hồ sơ</th>
              <th style={{ textAlign: 'right' }}>Tổng</th>
              <th style={{ textAlign: 'right' }}>Lưu trữ</th>
            </tr>
          </thead>
          <tbody>
            {typeStats.map(({ key, label, icon: Icon, total }) => (
              <tr key={key} style={total === 0 ? { opacity: 0.4 } : {}}>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Icon size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                    {label}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}><b>{total}</b></td>
                <td style={{ textAlign: 'right', color: total > 0 ? '#087b38' : 'var(--muted)' }}>{total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="data-grid stats-data-grid">
          {typeStats.map(({ key, label, icon: Icon, total }) => (
            <article className="data-card" key={key} style={total === 0 ? { opacity: 0.55 } : {}}>
              <div className="data-card-title-row">
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icon size={16} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                  <b>{label}</b>
                </span>
              </div>
              <div className="data-card-meta">
                <span>Tổng</span>
                <b>{total}</b>
              </div>
              <div className="data-card-meta">
                <span>Lưu trữ</span>
                <b style={{ color: total > 0 ? '#087b38' : 'var(--muted)' }}>{total}</b>
              </div>
            </article>
          ))}
        </div>
      </section>

    </>
  )
}
