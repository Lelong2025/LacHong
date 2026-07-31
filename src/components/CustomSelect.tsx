import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type SelectOption = {
  value: string
  label: string
}

type CustomSelectProps = {
  options: SelectOption[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  name?: string
  ariaLabel?: string
  className?: string
}

export function CustomSelect({
  options,
  value,
  defaultValue = '',
  onChange,
  name,
  ariaLabel,
  className = '',
}: CustomSelectProps) {
  const [internalValue, setInternalValue] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedValue = value ?? internalValue
  const selectedLabel = options.find(option => option.value === selectedValue)?.label ?? options[0]?.label ?? ''

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const select = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue)
    onChange?.(nextValue)
    setOpen(false)
  }

  return (
    <div className={`app-combobox ${className}`} ref={rootRef}>
      {name && <input type="hidden" name={name} value={selectedValue} />}
      <button type="button" onClick={() => setOpen(current => !current)} aria-label={ariaLabel} aria-expanded={open}>
        <span>{selectedLabel}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="app-combobox-menu">
          {options.map(option => (
            <button type="button" key={option.value || 'all'} onClick={() => select(option.value)}>
              <span>{option.label}</span>
              {selectedValue === option.value && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
