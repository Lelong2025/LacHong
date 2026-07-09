import { useEffect, useState } from 'react'
import { Download, FileText, Trash2 } from 'lucide-react'
import { useNotifier } from '../contexts/useNotifier'
import { supabase } from '../lib/supabase'

interface DocFile {
    id: string
    name: string
    file_kind: string
    object_path: string | null
}

interface PendingFile {
    name: string
    kind: 'attachment' | 'issued_attachment'
}

interface Props {
    documentId: string
    refreshKey?: number
    pendingFiles?: PendingFile[]
    onRemoveExistingFile?: (fileId: string) => void
    fileKind?: 'attachment' | 'issued_attachment'
    downloadFile?: (fileId: string) => Promise<void>
}

export function ListFileDoc({ documentId, refreshKey = 0, pendingFiles = [], onRemoveExistingFile, fileKind, downloadFile }: Props) {
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
        return () => { cancelled = true }
    }, [documentId, refreshKey, fileKind])

    if (loading) {
        return <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '8px 0' }}>Đang tải danh sách file...</p>
    }

    const hasSavedFiles = files.length > 0
    const hasPendingFiles = pendingFiles.length > 0

    if (!hasSavedFiles && !hasPendingFiles) {
        return <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '8px 0' }}>Chưa có file nào được lưu trong hồ sơ này.</p>
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            {/* File đã lưu (từ DB) */}
            {files.map(file => (
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
                        <FileText size={16} style={{ color: file.file_kind === 'issued_attachment' ? '#087b38' : 'var(--blue, #1e3a5f)', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>
                            {file.name || 'Unnamed'}
                        </span>
                        <span style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: file.file_kind === 'issued_attachment' ? 'rgba(8,123,56,0.08)' : 'rgba(30,58,95,0.08)',
                            color: file.file_kind === 'issued_attachment' ? '#087b38' : 'var(--blue, #1e3a5f)',
                            flexShrink: 0
                        }}>
                            {file.file_kind === 'issued_attachment' ? 'Lưu trữ' : 'Đính kèm'}
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
            ))}
            {/* File mới chọn (chưa upload) */}
            {pendingFiles.map((pf, idx) => (
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
                        <FileText size={16} style={{ color: pf.kind === 'issued_attachment' ? '#087b38' : 'var(--blue, #1e3a5f)', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pf.name}>
                            {pf.name}
                        </span>
                        <span style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: pf.kind === 'issued_attachment' ? 'rgba(8,123,56,0.08)' : 'rgba(30,58,95,0.08)',
                            color: pf.kind === 'issued_attachment' ? '#087b38' : 'var(--blue, #1e3a5f)',
                            flexShrink: 0
                        }}>
                            {pf.kind === 'issued_attachment' ? 'Lưu trữ' : 'Đính kèm'}
                        </span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--muted, #94a3b8)', fontStyle: 'italic', flexShrink: 0 }}>
                        Chưa lưu
                    </span>
                </div>
            ))}
        </div>
    )
}
