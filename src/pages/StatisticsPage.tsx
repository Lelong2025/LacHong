import { FileText, Hash, CheckCircle2, Send, Clock3, Stamp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { EmptyState } from '../components/EmptyState'
import { DataViewToggle, type DataViewMode } from '../components/DataViewToggle'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { DocumentRow } from '../types'

const documentTypeList = [
  { key: 'totrinh', label: 'Tờ Trình', icon: Send },
  { key: 'quyetdinh', label: 'Quyết Định', icon: Stamp },
  { key: 'khenthuong', label: 'Khen Thưởng', icon: CheckCircle2 },
  { key: 'baocao', label: 'Báo Cáo', icon: FileText },
  { key: 'kehoach', label: 'Kế Hoạch', icon: Clock3 },
]

const filterList = [
  ...documentTypeList,
  { key: 'banhanh', label: 'Ban Hành', icon: Hash },
]

const chartColors = ['#1E5FA8', '#4E9DB3', '#8DC7B2', '#F2C66D', '#D9865B', '#5F7F4D']
const matchesFilter = (document: DocumentRow, filter: string) => {
  if (!filter) return true
  if (filter === 'banhanh') return document.status === 'issued'
  return document.type === filter
}

function assigneeDisplayNames(value: string | null) {
  if (!value) return ['Chưa gán']
  const names = value
    .split(',')
    .map(item => item.trim().replace(/\s*\([^)]*@[^)]*\)/g, ''))
    .filter(Boolean)
  return names.length ? names : ['Chưa gán']
}

function StackedYearBarChart({
  items,
  years,
  max,
  emptyMessage,
}: {
  items: { name: string; total: number; segments: { year: number; total: number; color: string }[] }[]
  years: { year: number; color: string }[]
  max: number
  emptyMessage: string
}) {
  return (
    <>
      <div className="year-stacked-bar-chart">
        {items.map(item => (
          <div className="year-stacked-item" key={item.name}>
            <div className="year-stacked-track">
              {item.segments.map(segment => (
                <i
                  key={segment.year}
                  title={`${segment.year}: ${segment.total}`}
                  style={{
                    height: `${segment.total ? Math.max((segment.total / max) * 100, 8) : 0}%`,
                    background: segment.color,
                  }}
                />
              ))}
            </div>
            <b>{item.total}</b>
            <span title={item.name}>{item.name}</span>
          </div>
        ))}
        {!items.length && <EmptyState message={emptyMessage} />}
      </div>
      {years.length > 1 && (
        <div className="year-stacked-legend">
          {years.map(item => (
            <span key={item.year}><i style={{ background: item.color }} />{item.year}</span>
          ))}
        </div>
      )}
    </>
  )
}

export function StatisticsPage() {
  const { profile, user } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [error, setError] = useState('')
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()))
  const [typeFilter, setTypeFilter] = useState('')
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
  const chartYears = useMemo(() => [...availableYears].sort((a, b) => a - b), [availableYears])
  const yearColor = useCallback((year: number) => chartColors[Math.max(chartYears.indexOf(year), 0) % chartColors.length], [chartYears])

  const yearScopedDocuments = useMemo(() => documents.filter(doc => {
    if (!yearFilter) return true
    return (doc.document_year || new Date(doc.created_at).getFullYear()) === Number(yearFilter)
  }), [documents, yearFilter])

  const scopedDocuments = useMemo(() =>
    yearScopedDocuments.filter(doc => matchesFilter(doc, typeFilter)),
    [typeFilter, yearScopedDocuments]
  )

  const typeStats = useMemo(() =>
    filterList.map(({ key, label, icon }) => {
      const docs = yearScopedDocuments.filter(d => matchesFilter(d, key))
      return {
        key, label, icon,
        total: docs.length,
      }
    }),
    [yearScopedDocuments]
  )

  const assigneeYearStats = useMemo(() => {
    const years = Array.from(new Set(scopedDocuments.map(doc => doc.document_year || new Date(doc.created_at).getFullYear()))).sort((a, b) => a - b)
    const counts = scopedDocuments.reduce<Record<string, Record<number, number>>>((acc, doc) => {
      const year = doc.document_year || new Date(doc.created_at).getFullYear()
      for (const key of assigneeDisplayNames(doc.assignee_name)) {
        acc[key] ??= {}
        acc[key][year] = (acc[key][year] ?? 0) + 1
      }
      return acc
    }, {})
    const items = Object.entries(counts).map(([name, yearCounts]) => {
      const segments = years.map(year => ({
        year,
        total: yearCounts[year] ?? 0,
        color: yearColor(year),
      }))
      return {
        name,
        segments,
        total: segments.reduce((sum, segment) => sum + segment.total, 0),
      }
    }).sort((a, b) => b.total - a.total).slice(0, 10)

    return {
      items,
      years: years.map(year => ({ year, color: yearColor(year) })),
      max: Math.max(...items.map(item => item.total), 1),
    }
  }, [scopedDocuments, yearColor])

  const chartTypeStats = useMemo(
    () => typeFilter ? typeStats.filter(item => item.key === typeFilter) : typeStats.filter(item => item.key !== 'banhanh'),
    [typeFilter, typeStats]
  )
  const activeFilterLabel = filterList.find(item => item.key === typeFilter)?.label

  const pieGradient = useMemo(() => {
    let start = 0
    const total = Math.max(scopedDocuments.length, 1)
    return `conic-gradient(${chartTypeStats.map((item, index) => {
      const end = start + (item.total / total) * 100
      const segment = `${chartColors[index % chartColors.length]} ${start}% ${end}%`
      start = end
      return segment
    }).join(', ')})`
  }, [chartTypeStats, scopedDocuments.length])
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
        {filterList.map(({ key, label, icon: Icon }) => {
          const count = yearScopedDocuments.filter(d => matchesFilter(d, key)).length
          const active = typeFilter === key
          return (
            <article className={`metric-card clickable ${active ? 'active' : ''}`} key={key} onClick={() => setTypeFilter(active ? '' : key)} style={count === 0 && !active ? { opacity: 0.5, cursor: 'pointer' } : { cursor: 'pointer' }}>
              <Icon />
              <span>{label}</span>
              <b>{count}</b>
            </article>
          )
        })}
      </section>

      <section className="chart-grid">
        <article className="chart-card">
          <h2>{typeFilter ? `Dữ liệu ${activeFilterLabel}` : 'Số liệu theo loại hồ sơ'}</h2>
          <div className="pie-chart" style={{ background: pieGradient }} />
          <div className="chart-legend">
            {chartTypeStats.map((item, index) => (
              <span key={item.key}><i style={{ background: chartColors[index % chartColors.length] }} />{item.label}: {item.total}</span>
            ))}
          </div>
        </article>
        <article className="chart-card">
          <h2>Số liệu theo người thực hiện</h2>
          <StackedYearBarChart
            items={assigneeYearStats.items}
            years={assigneeYearStats.years}
            max={assigneeYearStats.max}
            emptyMessage="Chưa có dữ liệu người thực hiện."
          />
        </article>
      </section>

      {/* Bảng thống kê chi tiết theo loại và tình trạng */}
      <section className={`table-card data-view-card ${forceGrid || viewMode === 'grid' ? 'is-grid-view' : 'is-table-view'}`} style={{ marginBottom: '1.25rem' }}>
        <div className="table-card-header">
          <strong style={{ fontSize: '.9rem' }}>Chi tiết theo loại hồ sơ và tình trạng Ban Hành</strong>
          <DataViewToggle value={viewMode} onChange={setViewMode} forceGrid={forceGrid} />
        </div>
        <table>
          <thead>
            <tr>
              <th>Loại/Tình trạng</th>
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
