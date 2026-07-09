import { Archive, CheckCircle2, FilePlus2, Hash, MailPlus, Search, Send, Stamp, Trash2, UploadCloud, X, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { AssigneeOption, DocumentRow, DocumentStatus } from '../types'

const labels: Record<string, string> = {
  totrinh: 'Tờ trình',
  quyetdinh: 'Quyết định',
  khenthuong: 'Khen thưởng',
  baocao: 'Báo cáo',
  kehoach: 'Kế hoạch',
}

const statusLabels: Record<DocumentStatus, string> = {
  draft: 'Bản nháp',
  submitted: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  pending_issue: 'Chờ ban hành',
  issued: 'Đã ban hành',
  archived: 'Lưu trữ',
}

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const assigneeLabel = (option: AssigneeOption) => option.full_name ? `${option.full_name} (${option.email})` : option.email
const backendUrl = import.meta.env.VITE_BACKEND_URL

function FileDropzone({ label, files, onChange }: { label: string; files: File[]; onChange: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false)
  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    onChange([...files, ...Array.from(list)])
  }

  return (
    <label className={dragging ? 'dropzone dragging' : 'dropzone'} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }}>
      <span>{label}</span>
      <input type="file" multiple onChange={(event) => addFiles(event.target.files)} />
      <div>
        <UploadCloud />
        <b>Kéo và thả tệp vào đây hoặc <span className="browse-link">[Browse files]</span></b>
        <small>{files.length ? files.map((file) => file.name).join(', ') : ''}</small>
      </div>
      {files.length > 0 && <button type="button" className="clear-files" onClick={(event) => { event.preventDefault(); onChange([]) }}><X />Xóa file</button>}
    </label>
  )
}

export function DocumentsPage() {
  const { user, profile } = useAuth()
  const [items, setItems] = useState<DocumentRow[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [assigneeInput, setAssigneeInput] = useState('')
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([])
  const [selectedAssignee, setSelectedAssignee] = useState<AssigneeOption | null>(null)
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [issuedAttachments, setIssuedAttachments] = useState<File[]>([])

  async function uploadFiles(documentId: string, files: File[], fileKind: 'attachment' | 'issued_attachment') {
    if (!user || !files.length) return

    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) throw new Error(`File "${file.name}" vượt quá 5MB.`)

      const safeName = file.name.replace(/[^\w.-]+/g, '_')
      const objectPath = `${documentId}/${fileKind}/${crypto.randomUUID()}-${safeName}`
      const { error: uploadError } = await supabase.storage.from('documents').upload(objectPath, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (uploadError) throw uploadError

      const { error: fileError } = await supabase.from('document_files').insert({
        document_id: documentId,
        name: file.name,
        object_path: objectPath,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        file_kind: fileKind,
        created_by: user.id,
      })
      if (fileError) throw fileError
    }
  }

  const resetCreateForm = () => {
    setAssigneeInput('')
    setAssigneeOptions([])
    setSelectedAssignee(null)
    setInviteMessage('')
    setAttachments([])
    setIssuedAttachments([])
  }

  async function callBackend(path: string, body: Record<string, unknown>) {
    if (!backendUrl) throw new Error('Thiếu VITE_BACKEND_URL trong .env.')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Phiên đăng nhập không hợp lệ.')

    const response = await fetch(`${backendUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })

    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(payload.error || 'Backend xử lý thất bại.')
  }

  const load = useCallback(async () => {
    let query = supabase
      .from('documents')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })

    if (typeFilter) query = query.eq('type', typeFilter)
    if (search) query = query.ilike('title', `%${search}%`)
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) setError(error.message)
    else setItems((data || []) as DocumentRow[])
  }, [search, status, typeFilter])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('documents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => load())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  useEffect(() => {
    if (!show || selectedAssignee || assigneeInput.trim().length < 2) {
      setAssigneeOptions([])
      return
    }

    const timer = window.setTimeout(async () => {
      const { data } = await supabase.rpc('search_assignees', { p_query: assigneeInput.trim() })
      setAssigneeOptions((data || []) as AssigneeOption[])
    }, 250)

    return () => window.clearTimeout(timer)
  }, [assigneeInput, selectedAssignee, show])

  async function inviteAssignee() {
    const email = assigneeInput.trim()
    if (!isEmail(email)) {
      setInviteMessage('Nhập email hợp lệ để mời người thực hiện.')
      return
    }

    setInviting(true)
    setInviteMessage('')
    try {
      await callBackend('/api/invite-user', { email })
      setInviteMessage(`Đã gửi lời mời đến ${email}.`)
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'Không thể gửi lời mời.')
    } finally {
      setInviting(false)
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const content = String(form.get('content') || '').trim()
    const documentType = String(form.get('type') || 'totrinh')
    const assigneeName = selectedAssignee ? assigneeLabel(selectedAssignee) : assigneeInput.trim()
    const yearValue = Number(form.get('document_year') || new Date().getFullYear())

    try {
      const { data, error } = await supabase.from('documents').insert({
        type: documentType,
        title: content.slice(0, 250),
        description: content,
        assignee_name: assigneeName || null,
        assignee_id: selectedAssignee?.id ?? null,
        document_year: yearValue,
        created_by: user.id,
      }).select('id').single()

      if (error) throw error
      await uploadFiles(data.id, attachments, 'attachment')
      await uploadFiles(data.id, issuedAttachments, 'issued_attachment')
      if (selectedAssignee) {
        await callBackend('/api/notify-assignee', { documentId: data.id, assigneeId: selectedAssignee.id })
      }
      setShow(false)
      formElement.reset()
      resetCreateForm()
      void load()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Không thể tạo hồ sơ.')
    }
  }

  async function updateStatus(document: DocumentRow, nextStatus: DocumentStatus) {
    const { error } = await supabase
      .from('documents')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', document.id)

    if (error) setError(error.message)
    else void load()
  }

  async function review(document: DocumentRow, action: 'approve' | 'reject') {
    const nextStatus = action === 'approve' ? 'approved' : 'rejected'
    const { error: documentError } = await supabase
      .from('documents')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', document.id)

    if (documentError) {
      setError(documentError.message)
      return
    }

    await supabase.from('review_actions').insert({
      document_id: document.id,
      actor_id: user?.id,
      action,
      comment: action === 'approve' ? 'Admin đã duyệt hồ sơ' : 'Admin từ chối hồ sơ',
    })
    void load()
  }

  async function issue(document: DocumentRow) {
    const { error } = await supabase.rpc('issue_document', { p_document: document.id })
    if (error) setError(error.message)
    else void load()
  }

  async function remove(document: DocumentRow) {
    if (!confirm(`Xóa nháp "${document.title}"?`)) return
    const { error } = await supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id })
      .eq('id', document.id)

    if (error) setError(error.message)
    else void load()
  }

  const isAdmin = profile?.role === 'admin'

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Quản lý hồ sơ</h1>
          <p>Tra cứu, tạo mới, duyệt và theo dõi trạng thái hồ sơ.</p>
        </div>
        <button className="primary" onClick={() => { resetCreateForm(); setShow(true) }}><FilePlus2 />Tạo hồ sơ</button>
      </div>
      <section className="toolbar">
        <label>
          <Search />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tiêu đề..." />
        </label>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">Tất cả loại hồ sơ</option>
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Tất cả trạng thái</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span>{items.length} hồ sơ</span>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="table-card">
        <table>
          <thead>
            <tr>
              <th>Mã số</th>
              <th>Loại</th>
              <th>Tiêu đề / Nội dung</th>
              <th>Năm</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {items.map((document) => {
              const canEditDraft = document.created_by === user?.id && document.status === 'draft'
              return (
                <tr key={document.id}>
                  <td>{document.code || '-'}</td>
                  <td>{labels[document.type] || document.type}</td>
                  <td>
                    <b>{document.title}</b>
                    <small>{document.description}</small>
                  </td>
                  <td>{document.document_year || new Date(document.created_at).getFullYear()}</td>
                  <td><span className={`status ${document.status}`}>{statusLabels[document.status]}</span></td>
                  <td>
                    <div className="row-actions">
                      {canEditDraft && <button className="primary compact" onClick={() => updateStatus(document, 'submitted')}><Send />Gửi duyệt</button>}
                      {canEditDraft && <button className="danger-icon" title="Xóa nháp" onClick={() => remove(document)}><Trash2 /></button>}
                      {isAdmin && document.status === 'submitted' && <button className="primary compact" onClick={() => review(document, 'approve')}><CheckCircle2 />Duyệt</button>}
                      {isAdmin && document.status === 'submitted' && <button className="danger-icon text-button" onClick={() => review(document, 'reject')}><XCircle />Từ chối</button>}
                      {isAdmin && document.status === 'approved' && <button className="primary compact" onClick={() => updateStatus(document, 'pending_issue')}><Stamp />Chờ ban hành</button>}
                      {isAdmin && document.status === 'pending_issue' && <button className="primary compact" onClick={() => issue(document)}><Hash />Cấp số</button>}
                      {isAdmin && document.status === 'issued' && <button className="ghost compact" onClick={() => updateStatus(document, 'archived')}><Archive />Lưu trữ</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!items.length && <tr><td colSpan={6} className="empty">Chưa có hồ sơ.</td></tr>}
          </tbody>
        </table>
      </section>
      {show && (
        <div className="modal">
          <form className="document-form modal-container-style" onSubmit={create}>
            <div className="modal-form-header">
              <h2>Tạo hồ sơ mới</h2>
              <button type="button" className="btn-close" onClick={() => setShow(false)}><X /></button>
            </div>
            <div className="modal-form-body">
              <input type="hidden" name="type" value={typeFilter || 'totrinh'} />
              <div className="form-top-row">
                <div className="form-left-col">
                  <label className="form-group content-field-custom">
                    Nội dung
                    <textarea name="content" placeholder="Nhập nội dung hồ sơ..." required />
                  </label>
                </div>
                <div className="form-right-col">
                  <div className="row-flex">
                    <label className="form-group assignee-field-custom">
                      Người thực hiện
                      <div className="assignee-combobox">
                        <input value={assigneeInput} onChange={(event) => { setSelectedAssignee(null); setAssigneeInput(event.target.value); setInviteMessage('') }} onKeyDown={(event) => { if (event.key === 'Enter' && isEmail(assigneeInput) && !selectedAssignee) { event.preventDefault(); void inviteAssignee() } }} placeholder="Chọn hoặc nhập người thực hiện" />
                        {selectedAssignee && <button type="button" title="Bỏ chọn" onClick={() => { setSelectedAssignee(null); setAssigneeInput('') }}><X /></button>}
                        {!selectedAssignee && isEmail(assigneeInput) && <button type="button" className="invite-button" onClick={inviteAssignee} disabled={inviting}><MailPlus />{inviting ? 'Đang mời' : 'Mời'}</button>}
                        {assigneeOptions.length > 0 && <div className="assignee-options">{assigneeOptions.map((option) => <button type="button" key={option.id} onClick={() => { setSelectedAssignee(option); setAssigneeInput(assigneeLabel(option)); setAssigneeOptions([]); setInviteMessage('') }}>{assigneeLabel(option)}</button>)}</div>}
                      </div>
                      {inviteMessage && <small>{inviteMessage}</small>}
                    </label>
                    <label className="form-group year-field-custom">
                      Năm
                      <input name="document_year" type="number" min={2000} max={2100} defaultValue={new Date().getFullYear()} required />
                    </label>
                  </div>
                </div>
              </div>
              <div className="document-file-grid" style={{ marginTop: '24px' }}>
                <FileDropzone label="Đính kèm (mọi định dạng)" files={attachments} onChange={setAttachments} />
                <FileDropzone label="Đính kèm tệp ban hành (mọi định dạng)" files={issuedAttachments} onChange={setIssuedAttachments} />
              </div>
            </div>
            <div className="modal-form-footer">
              <button type="button" className="btn-cancel" onClick={() => setShow(false)}>Hủy</button>
              <button className="btn-submit">Lưu hồ sơ</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
