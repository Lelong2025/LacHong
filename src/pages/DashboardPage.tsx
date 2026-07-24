import { Archive, CheckCircle2, Clock3, FileText, Hash, Send, Stamp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { DataViewToggle, type DataViewMode } from '../components/DataViewToggle'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { emitSessionExpired } from '../lib/sessionExpiry'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { DocumentRow } from '../types'

const documentTypeLabels: Record<string, string> = {
  totrinh: 'Tờ Trình',
  quyetdinh: 'Quyết Định',
  khenthuong: 'Khen Thưởng',
  baocao: 'Báo Cáo',
  kehoach: 'Kế Hoạch',
}

const groupLabels: Record<string, string> = {
  ...documentTypeLabels,
  banhanh: 'Ban Hành',
}

const typeIcons: Record<string, typeof FileText> = {
  totrinh: Send,
  quyetdinh: Stamp,
  khenthuong: CheckCircle2,
  baocao: FileText,
  kehoach: Clock3,
  banhanh: Hash,
}

const chartColors = ['#1E5FA8', '#4E9DB3', '#8DC7B2', '#F2C66D', '#D9865B', '#5F7F4D']
const matchesGroup = (document: DocumentRow, group: string) => group === 'banhanh'
  ? document.status === 'issued'
  : document.type === group

function assigneeDisplayName(value: string | null) {
  if (!value) return 'Chưa gán'
  return value
    .split(',')
    .map(item => item.trim().replace(/\s*\([^)]*@[^)]*\)/g, ''))
    .filter(Boolean)
    .join(', ') || 'Chưa gán'
}

function assigneeDisplayNames(value: string | null) {
  if (!value) return ['Chưa gán']
  const names = value
    .split(',')
    .map(item => item.trim().replace(/\s*\([^)]*@[^)]*\)/g, ''))
    .filter(Boolean)
  return names.length ? names : ['Chưa gán']
}

function VerticalBarChart({ items, emptyMessage }: { items: { name: string; total: number }[]; emptyMessage: string }) {
  const max = Math.max(...items.map(item => item.total), 1)
  return (
    <div className="vertical-bar-chart">
      {items.map((item, index) => (
        <div className="vertical-bar-item" key={item.name}>
          <div className="vertical-bar-track">
            <i style={{ height: `${Math.max((item.total / max) * 100, 7)}%`, background: chartColors[index % chartColors.length] }} />
          </div>
          <b>{item.total}</b>
          <span title={item.name}>{item.name}</span>
        </div>
      ))}
      {!items.length && <EmptyState message={emptyMessage} />}
    </div>
  )
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

export function DashboardPage() {
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
      .channel(`dashboard-docs:${user?.id ?? 'anonymous'}`)
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

  const scopedDocuments = useMemo(() => documents.filter(doc => {
    if (!yearFilter) return true
    return (doc.document_year || new Date(doc.created_at).getFullYear()) === Number(yearFilter)
  }), [documents, yearFilter])

  const typeCounts = useMemo(() =>
    scopedDocuments.reduce<Record<string, number>>((acc, doc) => {
      const key = doc.type
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {}),
    [scopedDocuments]
  )

  const totalArchived = scopedDocuments.length
  const recentDocs = scopedDocuments.slice(0, 10)
  const typeStats = Object.entries(documentTypeLabels).map(([key, label]) => ({
    key,
    label,
    icon: typeIcons[key] ?? FileText,
    total: typeCounts[key] ?? 0,
  }))
  const issuedStat = {
    key: 'banhanh',
    label: groupLabels.banhanh,
    icon: typeIcons.banhanh,
    total: scopedDocuments.filter(doc => matchesGroup(doc, 'banhanh')).length,
  }
  const metricStats = [...typeStats, issuedStat]

  const assigneeStats = useMemo(() => {
    const counts = scopedDocuments.reduce<Record<string, number>>((acc, doc) => {
      for (const key of assigneeDisplayNames(doc.assignee_name)) {
        acc[key] = (acc[key] ?? 0) + 1
      }
      return acc
    }, {})
    return Object.entries(counts).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 8)
  }, [scopedDocuments])

  const typeAssigneeStats = useMemo(() =>
    Object.entries(groupLabels).map(([key, label]) => {
      const typeDocs = scopedDocuments.filter(doc => matchesGroup(doc, key))
      const years = Array.from(new Set(typeDocs.map(doc => doc.document_year || new Date(doc.created_at).getFullYear()))).sort((a, b) => a - b)
      const counts = typeDocs.reduce<Record<string, Record<number, number>>>((acc, doc) => {
        const year = doc.document_year || new Date(doc.created_at).getFullYear()
        for (const name of assigneeDisplayNames(doc.assignee_name)) {
          acc[name] ??= {}
          acc[name][year] = (acc[name][year] ?? 0) + 1
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
      }).sort((a, b) => b.total - a.total).slice(0, 6)
      return {
        key,
        label,
        years: years.map(year => ({ year, color: yearColor(year) })),
        items,
        max: Math.max(...items.map(item => item.total), 1),
      }
    }),
    [scopedDocuments, yearColor]
  )

  const pieGradient = useMemo(() => {
    let start = 0
    const total = Math.max(scopedDocuments.length, 1)
    const segments = typeStats.map((item, index) => {
      const end = start + (item.total / total) * 100
      const segment = `${chartColors[index % chartColors.length]} ${start}% ${end}%`
      start = end
      return segment
    })
    return `conic-gradient(${segments.join(', ')})`
  }, [scopedDocuments.length, typeStats])

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{isAdmin ? 'Tổng quan quản trị' : 'Tổng quan hồ sơ của tôi'}</h1>
          <p>{isAdmin
            ? 'Thống kê hồ sơ toàn hệ thống theo loại và tình trạng lưu trữ.'
            : 'Thống kê hồ sơ của bạn theo loại và tình trạng xử lý.'
          }</p>
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

      {/* === CHỈ SỐ TỔNG QUAN — MỘT HÀNG === */}
      <section className="metric-grid dashboard-metrics-row" style={{ marginBottom: '1.25rem' }}>
        <article className="metric-card dashboard-metric-card active">
          <FileText />
          <span>Tổng hồ sơ</span>
          <b>{scopedDocuments.length}</b>
        </article>
        <article className="metric-card dashboard-metric-card">
          <Archive />
          <span>Tổng lưu trữ</span>
          <b>{totalArchived}</b>
        </article>
        {metricStats.map(({ key, label, icon: Icon, total }) => (
          <article className="metric-card dashboard-metric-card" key={key} style={total === 0 ? { opacity: 0.5 } : {}}>
            <Icon />
            <span>{label}</span>
            <b>{total}</b>
          </article>
        ))}
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
          <VerticalBarChart items={assigneeStats} emptyMessage="Chưa có dữ liệu người thực hiện." />
        </article>
      </section>

      <section className="chart-grid type-assignee-grid">
        {typeAssigneeStats.map(item => (
          <article className="chart-card" key={item.key}>
            <h2>{`${item.label.charAt(0).toLocaleUpperCase('vi-VN')}${item.label.slice(1).toLocaleLowerCase('vi-VN')}`}</h2>
            <StackedYearBarChart items={item.items} years={item.years} max={item.max} emptyMessage="Chưa có dữ liệu." />
          </article>
        ))}
      </section>

      {/* === HỒ SƠ GẦN ĐÂY === */}
      <section className={`table-card data-view-card ${forceGrid || viewMode === 'grid' ? 'is-grid-view' : 'is-table-view'}`}>
        <div className="table-card-header">
          <strong style={{ fontSize: '.9rem' }}>Hồ sơ cập nhật gần nhất</strong>
          <DataViewToggle value={viewMode} onChange={setViewMode} forceGrid={forceGrid} />
        </div>
        <table>
          <thead>
            <tr>
              <th>Hồ sơ</th>
              <th>Loại</th>
              {isAdmin && <th>Người thực hiện</th>}
              <th>Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {recentDocs.map((doc) => (
              <tr key={doc.id}>
                <td><b>{doc.title}</b><small>{doc.description}</small></td>
                <td>{documentTypeLabels[doc.type] || doc.type}</td>
                {isAdmin && <td>{assigneeDisplayName(doc.assignee_name) || <span style={{ color: 'var(--muted)' }}>—</span>}</td>}
                <td>{new Date(doc.updated_at).toLocaleDateString('vi-VN')}</td>
              </tr>
            ))}
            {!recentDocs.length && (
              <tr><td colSpan={isAdmin ? 4 : 3}><EmptyState message="Chưa có hồ sơ nào." /></td></tr>
            )}
          </tbody>
        </table>
        <div className="data-grid">
          {recentDocs.map((doc) => (
            <article className="data-card" key={doc.id}>
              <div className="data-card-title-row">
                <span className="status">{documentTypeLabels[doc.type] || doc.type}</span>
                <span>{new Date(doc.updated_at).toLocaleDateString('vi-VN')}</span>
              </div>
              <div className="data-card-main text-only">
                <b>{doc.title}</b>
                {doc.description && <small>{doc.description}</small>}
              </div>
              {isAdmin && (
                <div className="data-card-meta">
                  <span>Người thực hiện</span>
                  <b>{assigneeDisplayName(doc.assignee_name) || '—'}</b>
                </div>
              )}
            </article>
          ))}
          {!recentDocs.length && <EmptyState message="Chưa có hồ sơ nào." />}
        </div>
      </section>
    </>
  )
}
