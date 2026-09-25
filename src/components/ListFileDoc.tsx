import { useEffect, useState } from 'react'
import { Download, FileSpreadsheet, FileText, Image as ImageIcon, Trash2 } from 'lucide-react'
import { useNotifier } from '../contexts/useNotifier'
import { supabase } from '../lib/supabase'
import { type FileCategory, getFileCategory } from '../lib/fileTypes'

export interface DocFile {
    id: string
    name: string
    file_kind: string
    object_path: string | null
}

export interface PendingFile {
    name: string
    kind: 'attachment' | 'issued_attachment'
}

export function FileIconBadge({ name, kind, size = 16 }: { name: string; kind?: string; size?: number }) {
    const cat = getFileCategory(name)
    if (cat === 'excel') {
        return <FileSpreadsheet size={size} style={{ color: '#16a34a', flexShrink: 0 }} />
    }
    if (cat === 'image') {
        return <ImageIcon size={size} style={{ color: '#9333ea', flexShrink: 0 }} />
    }
    if (cat === 'pdf') {
        return <FileText size={size} style={{ color: kind === 'issued_attachment' ? '#087b38' : '#dc2626', flexShrink: 0 }} />
    }
    return <FileText size={size} style={{ color: 'var(--blue, #1e3a5f)', flexShrink: 0 }} />
}

interface Props {
    documentId: string
    refreshKey?: number
    pendingFiles?: PendingFile[]
    onRemoveExistingFile?: (fileId: string) => void
    fileKind?: 'attachment' | 'issued_attachment'
    fileCategory?: FileCategory
    downloadFile?: (fileId: string) => Promise<void>
    previewFile?: (fileId: string) => Promise<void>
}

export function ListFileDoc({ documentId, refreshKey = 0, pendingFiles = [], onRemoveExistingFile, fileKind, fileCategory, downloadFile, previewFile }: Props) {
    const { notify } = useNotifier()
    const [files, setFiles] = useState<DocFile[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!documentId) return
        let cancelled = false

        async function loadFiles() {
            setLoading(true)
            try {
                let query = supabase
                    .from('document_files')
                    .select('id, document_id, name, file_kind, object_path')
                    .eq('document_id', documentId)
                    .is('deleted_at', null)

                if (fileKind) {
                    query = query.eq('file_kind', fileKind)
                }

                const { data, error } = await query.order('created_at', { ascending: true })

                if (error) throw error

                if (!cancelled) setFiles((data || []) as DocFile[])
            } catch (err) {
                console.error('Lỗi tải file:', err)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void loadFiles()
        const channel = supabase
            .channel(`document-files:${documentId}:${fileKind ?? 'all'}:${fileCategory ?? 'all'}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'document_files',
                filter: `document_id=eq.${documentId}`,
            }, () => { void loadFiles() })
            .subscribe()

        return () => {
            cancelled = true
            void supabase.removeChannel(channel)
        }
    }, [documentId, refreshKey, fileKind, fileCategory])

    if (loading) {
        return <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '8px 0' }}>Đang tải danh sách file...</p>
    }

    const filteredFiles = fileCategory ? files.filter(f => getFileCategory(f.name) === fileCategory) : files
    const filteredPending = fileCategory ? pendingFiles.filter(pf => getFileCategory(pf.name) === fileCategory) : pendingFiles

    const hasSavedFiles = filteredFiles.length > 0
    const hasPendingFiles = filteredPending.length > 0

    if (!hasSavedFiles && !hasPendingFiles) {
        if (fileCategory) return null
        return <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '8px 0' }}>Chưa có file nào được lưu trong hồ sơ này.</p>
    }

    const getBadgeStyle = (fKind: string, name: string) => {
        const cat = getFileCategory(name)
        if (fKind === 'issued_attachment') {
            return { bg: 'rgba(8,123,56,0.08)', color: '#087b38', label: 'Lưu trữ' }
        }
        if (cat === 'excel') {
            return { bg: 'rgba(22,163,74,0.1)', color: '#16a34a', label: 'Excel' }
        }
        if (cat === 'image') {
            return { bg: 'rgba(147,51,234,0.1)', color: '#9333ea', label: 'Ảnh' }
        }
        if (cat === 'word') {
            return { bg: 'rgba(30,58,95,0.08)', color: 'var(--blue, #1e3a5f)', label: 'Word' }
        }
        return { bg: 'rgba(100,116,139,0.1)', color: '#64748b', label: 'Đính kèm' }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            {/* File đã lưu (từ DB) */}
            {filteredFiles.map(file => {
                const badge = getBadgeStyle(file.file_kind, file.name)
                return (
                    <div
                        key={file.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            border: '1px solid var(--line, #e2e8f0)',
                            borderRadius: '6px',
                            background: 'var(--surface, #fff)'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <FileIconBadge name={file.name} kind={file.file_kind} size={16} />
                            <button
                                type="button"
                                onClick={() => previewFile && void previewFile(file.id)}
                                disabled={!previewFile}
                                style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 0, padding: 0, background: 'transparent', color: 'var(--blue, #1e3a5f)', cursor: previewFile ? 'pointer' : 'default', textDecoration: previewFile ? 'underline' : 'none', textUnderlineOffset: '3px', textAlign: 'left' }}
                                title={previewFile ? `Xem ${file.name}` : file.name}
                            >
                                {file.name || 'Unnamed'}
                            </button>
                            <span style={{
                                fontSize: '11px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: badge.bg,
                                color: badge.color,
                                flexShrink: 0
                            }}>
                                {badge.label}
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            {downloadFile && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void downloadFile(file.id).catch((error) => {
                                            notify(error instanceof Error ? error.message : 'Không tải được file.', 'error')
                                        })
                                    }}
                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text, #1e3a5f)', textDecoration: 'none', fontSize: '13px', fontWeight: 500, border: 0, background: 'transparent', cursor: 'pointer', padding: 0 }}
                                >
                                    <Download size={14} />
                                    Tải
                                </button>
                            )}
                            {onRemoveExistingFile && (
                                <button
                                    type="button"
                                    onClick={() => onRemoveExistingFile(file.id)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--danger, #dc2626)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 500, padding: '2px 4px', borderRadius: '4px' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,38,38,0.06)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                    title="Xóa file này"
                                >
                                    <Trash2 size={13} />
                                    Xóa
                                </button>
                            )}
                        </div>
                    </div>
                )
            })}
            {/* File mới chọn (chưa upload) */}
            {filteredPending.map((pf, idx) => {
                const badge = getBadgeStyle(pf.kind, pf.name)
                return (
                    <div
                        key={`pending-${idx}`}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            border: '1px dashed var(--line, #cbd5e1)',
                            borderRadius: '6px',
                            background: 'var(--surface-soft, #f8fafc)'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <FileIconBadge name={pf.name} kind={pf.kind} size={16} />
                            <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pf.name}>
                                {pf.name}
                            </span>
                            <span style={{
                                fontSize: '11px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: badge.bg,
                                color: badge.color,
                                flexShrink: 0
                            }}>
                                {badge.label}
                            </span>
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--muted, #94a3b8)', fontStyle: 'italic', flexShrink: 0 }}>
                            Chưa lưu
                        </span>
                    </div>
                )
            })}
        </div>
    )
}
