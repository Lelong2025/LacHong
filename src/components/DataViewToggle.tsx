import { LayoutGrid, Table2 } from 'lucide-react'

export type DataViewMode = 'table' | 'grid'

type DataViewToggleProps = {
  value: DataViewMode
  onChange: (value: DataViewMode) => void
  forceGrid?: boolean
}

export function DataViewToggle({ value, onChange, forceGrid = false }: DataViewToggleProps) {
  const activeValue = forceGrid ? 'grid' : value

  return (
    <div className="view-toggle" aria-label="Chế độ xem">
      <button
        type="button"
        className={activeValue === 'table' ? 'active' : ''}
        onClick={() => onChange('table')}
        title="Xem dạng bảng"
        aria-pressed={activeValue === 'table'}
        disabled={forceGrid}
      >
        <Table2 />
      </button>
      <button
        type="button"
        className={activeValue === 'grid' ? 'active' : ''}
        onClick={() => onChange('grid')}
        title="Xem dạng lưới"
        aria-pressed={activeValue === 'grid'}
      >
        <LayoutGrid />
      </button>
    </div>
  )
}
