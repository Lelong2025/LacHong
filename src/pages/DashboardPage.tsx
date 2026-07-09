import { Archive, CheckCircle2, Clock3, FileText, Hash, Send, Stamp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { DocumentRow } from '../types'

const typeLabels: Record<string, string> = {
  totrinh: 'Tờ trình',
  quyetdinh: 'Quyết định',
  khenthuong: 'Khen thưởng',
  baocao: 'Báo cáo',
  kehoach: 'Kế hoạch',
  banhanh: 'Ban hành',
}

const typeIcons: Record<string, typeof FileText> = {
  totrinh: Send,
  quyetdinh: Stamp,
  khenthuong: CheckCircle2,
  baocao: FileText,
  kehoach: Clock3,
  banhanh: Hash,
}

const chartColors = ['#164877', '#087b38', '#9a6200', '#7c3aed', '#0f766e', '#b42318']

function assigneeDisplayName(value: string | null) {
  if (!value) return 'Chưa gán'
  return value
    .split(',')
    .map(item => item.trim().replace(/\s*\([^)]*@[^)]*\)/g, ''))
    .filter(Boolean)
    .join(', ') || 'Chưa gán'
}

export function DashboardPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [error, setError] = useState('')
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()))

  const load = useCallback(async () => {
    let query = supabase
      .from('documents')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(500)

    const { data, error } = await query
    if (error) setError(error.message)
    else setDocuments((data || []) as DocumentRow[])
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('dashboard-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  const availableYears = useMemo(() => {
    const years = new Set(documents.map(doc => doc.document_year || new Date(doc.created_at).getFullYear()))
    years.add(new Date().getFullYear())
    return Array.from(years).sort((a, b) => b - a)
  }, [documents])

  const scopedDocuments = useMemo(() => documents.filter(doc => {
    if (!yearFilter) return true
    return (doc.document_year || new Date(doc.created_at).getFullYear()) === Number(yearFilter)
  }), [documents, yearFilter])

  const typeCounts = useMemo(() =>
    scopedDocuments.reduce<Record<string, number>>((acc, doc) => {
      acc[doc.type] = (acc[doc.type] ?? 0) + 1
      return acc
    }, {}),
    [scopedDocuments]
  )

  const totalArchived = scopedDocuments.length
  const recentDocs = scopedDocuments.slice(0, 10)
  const typeStats = Object.entries(typeLabels).map(([key, label]) => ({
    key,
    label,
    icon: typeIcons[key] ?? FileText,
    total: typeCounts[key] ?? 0,
  }))

  const assigneeStats = useMemo(() => {
    const counts = scopedDocuments.reduce<Record<string, number>>((acc, doc) => {
      const key = assigneeDisplayName(doc.assignee_name)
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
    return Object.entries(counts).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 8)
  }, [scopedDocuments])

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

  const maxAssigneeTotal = Math.max(...assigneeStats.map(item => item.total), 1)

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

      {/* === METRIC GRID — 1 level: tổng quan + theo loại === */}
      <section className="metric-grid" style={{ marginBottom: '1.25rem' }}>
        <article className="metric-card dashboard-metric-card active">
          <FileText />
          <span>Tổng hồ sơ</span>
          <b>{scopedDocuments.length}</b>
        </article>
        <article className="metric-card dashboard-metric-card">
          <Archive style={{ color: '#087b38' }} />
          <span>Tổng lưu trữ</span>
          <b style={totalArchived > 0 ? { color: '#087b38' } : {}}>{totalArchived}</b>
        </article>
        {typeStats.map(({ key, label, icon: Icon, total }) => (
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

      {/* === HỒ SƠ GẦN ĐÂY === */}
      <section className="table-card">
        <div style={{ padding: '1rem 1.2rem', borderBottom: '1px solid var(--line)' }}>
          <strong style={{ fontSize: '.9rem' }}>Hồ sơ cập nhật gần nhất</strong>
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
                <td>{typeLabels[doc.type] || doc.type}</td>
                {isAdmin && <td>{assigneeDisplayName(doc.assignee_name) || <span style={{ color: 'var(--muted)' }}>—</span>}</td>}
                <td>{new Date(doc.updated_at).toLocaleDateString('vi-VN')}</td>
              </tr>
            ))}
            {!recentDocs.length && (
              <tr><td colSpan={isAdmin ? 4 : 3}><EmptyState message="Chưa có hồ sơ nào." /></td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  )
}
