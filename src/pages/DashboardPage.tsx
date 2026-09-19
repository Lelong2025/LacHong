import { Archive, CheckCircle2, Clock3, FileText, Hash, Send, Stamp, BadgeCheck, Mail, Bell, ClipboardList, Newspaper, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { DataViewToggle, type DataViewMode } from '../components/DataViewToggle'
import { CustomSelect } from '../components/CustomSelect'
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
  xacnhan: 'Xác Nhận',
  congvan: 'Công Văn',
  thongbao: 'Thông Báo',
  bienbanhop: 'Biên Bản Họp',
  duatin: 'Đưa Tin',
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
  xacnhan: BadgeCheck,
  congvan: Mail,
  thongbao: Bell,
  bienbanhop: ClipboardList,
  duatin: Newspaper,
  banhanh: Hash,
}

const chartColors = ['#1E5FA8', '#4E9DB3', '#8DC7B2', '#F2C66D', '#D9865B', '#5F7F4D', '#845EC2', '#D65DB1', '#FF6F91', '#2C73D2']
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

function CumulativeGrowthChart({
  documents,
  yearFilter,
  monthFilter,
}: {
  documents: DocumentRow[]
  yearFilter: string
  monthFilter: string
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const timelineData = useMemo(() => {
    if (!documents.length) return []

    // Nếu chọn tháng cụ thể: hiển thị đầy đủ các ngày trong tháng
    if (monthFilter) {
      const year = yearFilter ? Number(yearFilter) : new Date().getFullYear()
      const month = Number(monthFilter)
      const daysInMonth = new Date(year, month, 0).getDate()
      let runningTotal = 0
      const points = []

      for (let day = 1; day <= daysInMonth; day++) {
        const datePrefix = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const dailyCount = documents.filter(doc => {
          const docDate = doc.created_at ? doc.created_at.slice(0, 10) : ''
          return docDate === datePrefix
        }).length
        runningTotal += dailyCount
        points.push({
          dateKey: datePrefix,
          label: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`,
          fullDate: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
          dailyCount,
          cumulativeCount: runningTotal,
        })
      }
      return points
    }

    // Nếu không chọn tháng: Gom theo các ngày phát sinh hồ sơ theo thứ tự thời gian
    const dailyMap = new Map<string, number>()
    const sortedDocs = [...documents].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    for (const doc of sortedDocs) {
      const dayKey = doc.created_at ? doc.created_at.slice(0, 10) : ''
      if (dayKey) {
        dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + 1)
      }
    }

    let runningTotal = 0
    const points: { dateKey: string; label: string; fullDate: string; dailyCount: number; cumulativeCount: number }[] = []

    const sortedDayKeys = Array.from(dailyMap.keys()).sort()
    for (const dayKey of sortedDayKeys) {
      const count = dailyMap.get(dayKey) ?? 0
      runningTotal += count
      const [y, m, d] = dayKey.split('-')
      points.push({
        dateKey: dayKey,
        label: `${d}/${m}`,
        fullDate: `${d}/${m}/${y}`,
        dailyCount: count,
        cumulativeCount: runningTotal,
      })
    }

    return points
  }, [documents, yearFilter, monthFilter])

  if (!timelineData.length || timelineData.every(p => p.cumulativeCount === 0)) {
    return (
      <article className="chart-card cumulative-chart-card">
        <div className="cumulative-chart-header">
          <div className="cumulative-chart-title">
            <TrendingUp className="chart-title-icon" />
            <div>
              <h2>Tăng trưởng tổng hồ sơ cộng dồn theo ngày</h2>
              <p>Hồ sơ mỗi ngày cộng dồn với tổng ngày trước để thể hiện xu hướng lũy kế.</p>
            </div>
          </div>
        </div>
        <div className="cumulative-chart-empty" style={{ padding: '2rem 0' }}>
          <EmptyState message="Chưa có dữ liệu hồ sơ để vẽ biểu đồ tăng trưởng." />
        </div>
      </article>
    )
  }

function getSmoothCurvePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`
  if (pts.length === 2) {
    const dx = pts[1].x - pts[0].x
    return `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} C ${(pts[0].x + dx / 3).toFixed(1)},${pts[0].y.toFixed(1)} ${(pts[1].x - dx / 3).toFixed(1)},${pts[1].y.toFixed(1)} ${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`
  }

  let path = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? i : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]

    const dx = p2.x - p1.x
    const slope1 = (p2.y - p0.y) / (p2.x - p0.x || 1)
    const slope2 = (p3.y - p1.y) / (p3.x - p1.x || 1)

    const cp1x = p1.x + dx / 3
    let cp1y = p1.y + (slope1 * dx) / 3

    const cp2x = p2.x - dx / 3
    let cp2y = p2.y - (slope2 * dx) / 3

    const minY = Math.min(p1.y, p2.y)
    const maxY = Math.max(p1.y, p2.y)
    cp1y = Math.max(minY, Math.min(maxY, cp1y))
    cp2y = Math.max(minY, Math.min(maxY, cp2y))

    path += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return path
}

  const maxVal = Math.max(...timelineData.map(p => p.cumulativeCount), 1)
  const yAxisMax = maxVal <= 5 ? 5 : Math.ceil(maxVal * 1.15)
  const totalCumulative = timelineData[timelineData.length - 1]?.cumulativeCount ?? 0
  const maxDaily = Math.max(...timelineData.map(p => p.dailyCount))

  const svgWidth = 900
  const svgHeight = 250
  const padLeft = 24
  const padRight = 14
  const padTop = 18
  const padBottom = 35
  const plotWidth = svgWidth - padLeft - padRight
  const plotHeight = svgHeight - padTop - padBottom

  const getX = (index: number) => {
    if (timelineData.length <= 1) return padLeft + plotWidth / 2
    return padLeft + (index / (timelineData.length - 1)) * plotWidth
  }

  const getY = (val: number) => {
    return padTop + plotHeight - (val / yAxisMax) * plotHeight
  }

  const pointsCoords = timelineData.map((pt, i) => ({
    ...pt,
    x: getX(i),
    y: getY(pt.cumulativeCount),
  }))

  const pathD = getSmoothCurvePath(pointsCoords)

  const firstPt = pointsCoords[0]
  const lastPt = pointsCoords[pointsCoords.length - 1]
  const areaD = `${pathD} L ${lastPt.x},${padTop + plotHeight} L ${firstPt.x},${padTop + plotHeight} Z`

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(ratio => Math.round(ratio * yAxisMax))
  const xTickInterval = Math.max(1, Math.ceil(timelineData.length / 8))
  const activePoint = hoveredIndex !== null ? pointsCoords[hoveredIndex] : null

  return (
    <article className="chart-card cumulative-chart-card">
      <div className="cumulative-chart-header">
        <div className="cumulative-chart-title">
          <TrendingUp className="chart-title-icon" />
          <div>
            <h2>Tăng trưởng tổng hồ sơ cộng dồn theo ngày</h2>
            <p>Hồ sơ mỗi ngày cộng dồn với tổng ngày trước để thể hiện xu hướng lũy kế.</p>
          </div>
        </div>
      </div>

      <div className="cumulative-chart-body">
        <div className="cumulative-chart-main">
          <div className="cumulative-chart-svg-wrap" style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="cumulative-svg"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <defs>
            <linearGradient id="cumulativeAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1E5FA8" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#1E5FA8" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {yTicks.map(val => {
            const y = getY(val)
            return (
              <g key={val}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={svgWidth - padRight}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize="11"
                  fontWeight="500"
                >
                  {val}
                </text>
              </g>
            )
          })}

          <path d={areaD} fill="url(#cumulativeAreaGrad)" />

          <path
            d={pathD}
            fill="none"
            stroke="#1E5FA8"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {pointsCoords.map((pt, i) => {
            if (i % xTickInterval !== 0 && i !== pointsCoords.length - 1) return null
            return (
              <text
                key={pt.dateKey}
                x={pt.x}
                y={svgHeight - 12}
                textAnchor="middle"
                fill="#64748b"
                fontSize="11"
                fontWeight="500"
              >
                {pt.label}
              </text>
            )
          })}

          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                y1={padTop}
                x2={activePoint.x}
                y2={padTop + plotHeight}
                stroke="#1E5FA8"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                opacity="0.8"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="6"
                fill="#1E5FA8"
                stroke="#fff"
                strokeWidth="2.5"
              />
            </g>
          )}

          {pointsCoords.map((pt, i) => (
            <g
              key={pt.dateKey}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={pt.x}
                cy={pt.y}
                r={pt.dailyCount > 0 ? 3.5 : 2}
                fill={pt.dailyCount > 0 ? '#1E5FA8' : '#fff'}
                stroke="#1E5FA8"
                strokeWidth="1.5"
              />
              <rect
                x={pt.x - (plotWidth / pointsCoords.length) / 2}
                y={padTop}
                width={plotWidth / pointsCoords.length}
                height={plotHeight}
                fill="transparent"
              />
            </g>
          ))}
        </svg>

        {activePoint && (
          <div
            className="cumulative-tooltip"
            style={{
              position: 'absolute',
              left: `${(activePoint.x / svgWidth) * 100}%`,
              top: `${(activePoint.y / svgHeight) * 100}%`,
              transform: 'translate(-50%, -120%)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <div className="tooltip-date">{activePoint.fullDate}</div>
            <div className="tooltip-daily">Mới trong ngày: <b>+{activePoint.dailyCount}</b></div>
            <div className="tooltip-total">Tổng cộng dồn: <b>{activePoint.cumulativeCount} hồ sơ</b></div>
          </div>
        )}
        </div>
      </div>

      <div className="cumulative-chart-sidebar">
        <div className="chart-stat-badge">
          <span className="badge-label">Tổng cộng dồn</span>
          <span className="badge-value">{totalCumulative} <span className="badge-unit">hồ sơ</span></span>
        </div>
        <div className="chart-stat-badge">
          <span className="badge-label">Mới cao nhất/ngày</span>
          <span className="badge-value">+{maxDaily}</span>
        </div>
      </div>
    </div>
  </article>
  )
}

export function DashboardPage() {
  const { profile, user } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [error, setError] = useState('')
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()))
  const [monthFilter, setMonthFilter] = useState('')
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
    const docDate = new Date(doc.created_at)
    const docYear = doc.document_year || docDate.getFullYear()
    const docMonth = docDate.getMonth() + 1

    const matchesYear = !yearFilter || docYear === Number(yearFilter)
    const matchesMonth = !monthFilter || docMonth === Number(monthFilter)

    return matchesYear && matchesMonth
  }), [documents, yearFilter, monthFilter])

  const typeCounts = useMemo(() =>
    scopedDocuments.reduce<Record<string, number>>((acc, doc) => {
      const key = doc.type
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {}),
    [scopedDocuments]
  )

  const totalArchived = scopedDocuments.length
  const recentDocs = scopedDocuments.slice(0, 5)
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
        <span>Thống kê theo</span>
        <CustomSelect
          className="year-combobox"
          value={yearFilter}
          onChange={setYearFilter}
          ariaLabel="Thống kê theo năm"
          options={[{ value: '', label: 'Tất cả năm' }, ...availableYears.map(year => ({ value: String(year), label: String(year) }))]}
        />
        <CustomSelect
          className="month-combobox"
          value={monthFilter}
          onChange={setMonthFilter}
          ariaLabel="Thống kê theo tháng"
          options={[
            { value: '', label: 'Tất cả các tháng' },
            ...Array.from({ length: 12 }, (_, i) => ({
              value: String(i + 1),
              label: `Tháng ${i + 1}`,
            })),
          ]}
        />
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
          {scopedDocuments.length} hồ sơ
        </span>
      </section>

      {/* === CHỈ SỐ TỔNG QUAN — MỘT HÀNG === */}
      <section className="metric-grid dashboard-metrics-row" style={{ marginBottom: '1.25rem' }}>
        <article className="metric-card dashboard-metric-card active">
          <span className="metric-icon"><FileText /></span>
          <span className="metric-copy">
            <span>Tổng hồ sơ</span>
            <b>{scopedDocuments.length}</b>
          </span>
        </article>
        <article className="metric-card dashboard-metric-card">
          <span className="metric-icon"><Archive /></span>
          <span className="metric-copy">
            <span>Tổng lưu trữ</span>
            <b>{totalArchived}</b>
          </span>
        </article>
        {metricStats.map(({ key, label, icon: Icon, total }) => (
          <article className={`metric-card dashboard-metric-card${total === 0 ? ' is-empty' : ''}`} key={key}>
            <span className="metric-icon"><Icon /></span>
            <span className="metric-copy">
              <span>{label}</span>
              <b>{total}</b>
            </span>
          </article>
        ))}
      </section>

      {/* === BIỂU ĐỒ TĂNG TRƯỞNG CỘNG DỒN THEO NGÀY === */}
      <section className="wide-chart-card">
        <CumulativeGrowthChart documents={scopedDocuments} yearFilter={yearFilter} monthFilter={monthFilter} />
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
