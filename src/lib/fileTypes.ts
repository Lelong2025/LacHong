export type FileCategory = 'word' | 'excel' | 'image' | 'pdf' | 'other'

export function getFileCategory(name: string): FileCategory {
  if (/\.(docx?)$/i.test(name)) return 'word'
  if (/\.(xlsx?|csv)$/i.test(name)) return 'excel'
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name)) return 'image'
  if (/\.pdf$/i.test(name)) return 'pdf'
  return 'other'
}

export const isWordFile = (file: File) => /\.(doc|docx)$/i.test(file.name)

export const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf'

export const isExcelFile = (file: File) =>
  /\.(xlsx|xls|csv)$/i.test(file.name) ||
  file.type.includes('spreadsheet') ||
  file.type.includes('excel') ||
  file.type === 'text/csv'

export const isImageFile = (file: File) =>
  /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name) || file.type.startsWith('image/')
