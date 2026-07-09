import cors from 'cors'
import { randomUUID } from 'node:crypto'
import 'dotenv/config'
import express from 'express'
import nodemailer from 'nodemailer'
import WebSocket from 'ws'
import { createClient, type User } from '@supabase/supabase-js'

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const app = express()
const port = Number(process.env.PORT ?? 3001)
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? '*'
const publicSiteUrl = process.env.PUBLIC_SITE_URL ?? frontendOrigin
const allowedOrigins = new Set(
  [
    ...frontendOrigin.split(',').map((origin) => origin.trim()).filter(Boolean),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://lelong2025.github.io',
  ].filter((origin) => origin !== '*'),
)

const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
})

const mailer = nodemailer.createTransport({
  host: required('SMTP_HOST'),
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: required('SMTP_USER'),
    pass: required('SMTP_PASS'),
  },
})

app.use(cors({
  origin: frontendOrigin === '*'
    ? true
    : (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`))
    },
}))
app.use(express.json({ limit: '8mb' }))

type AuthedRequest = express.Request & { user?: User }

async function requireUser(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' })
    return
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid authorization token' })
    return
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,is_active')
    .eq('id', data.user.id)
    .single()

  if (profileError || !profile?.is_active) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  req.user = data.user
  next()
}

async function sendMail(to: string, subject: string, html: string) {
  await mailer.sendMail({
    from: {
      name: process.env.SMTP_FROM_NAME ?? 'He thong Lac Hong',
      address: required('SMTP_FROM'),
    },
    to,
    subject,
    html,
  })
}

async function ensureDocumentsBucket() {
  const bucketOptions = {
    public: false,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: null,
  }

  const { error: updateError } = await supabase.storage.updateBucket('documents', bucketOptions)
  if (!updateError) return

  const { error: createError } = await supabase.storage.createBucket('documents', bucketOptions)
  if (createError) {
    console.error('Unable to prepare documents bucket:', createError.message)
  }
}

async function uploadDocumentObject(objectPath: string, fileBuffer: Buffer, mimeType: string) {
  let result = await supabase.storage.from('documents').upload(objectPath, fileBuffer, {
    contentType: mimeType,
  })

  if (!result.error) return result

  await ensureDocumentsBucket()
  result = await supabase.storage.from('documents').upload(objectPath, fileBuffer, {
    contentType: mimeType,
  })

  return result
}

const toSafeStorageName = (name: string) => name.replace(/[^\w.-]+/g, '_')

async function downloadDocumentObject(objectPath: string) {
  const { data, error } = await supabase.storage.from('documents').download(objectPath)
  if (error || !data) return { buffer: null, error }

  const arrayBuffer = await data.arrayBuffer()
  return { buffer: Buffer.from(arrayBuffer), error: null }
}

async function findExistingDocumentObject(documentId: string, fileKind: string | null, name: string, currentPath: string | null) {
  const safeName = toSafeStorageName(name)
  const prefixes = Array.from(new Set([
    fileKind ? `${documentId}/${fileKind}` : '',
    `${documentId}/attachment`,
    `${documentId}/issued_attachment`,
  ].filter(Boolean)))

  for (const prefix of prefixes) {
    const { data, error } = await supabase.storage.from('documents').list(prefix, {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'desc' },
    })

    if (error) continue

    for (const item of data || []) {
      const fullPath = `${prefix}/${item.name}`
      if (
        fullPath === currentPath ||
        item.name === name ||
        item.name === safeName ||
        item.name.endsWith(`-${safeName}`) ||
        item.name.endsWith(`-${name}`)
      ) {
        return fullPath
      }
    }
  }

  return null
}

async function permanentlyDeleteDocument(documentId: string) {
  const { data: files } = await supabase
    .from('document_files')
    .select('object_path')
    .eq('document_id', documentId)

  const objectPaths = (files || [])
    .map(file => file.object_path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0)

  if (objectPaths.length > 0) {
    const { error: storageError } = await supabase.storage.from('documents').remove(objectPaths)
    if (storageError) return storageError
  }

  for (const table of ['document_files', 'document_versions', 'review_actions', 'issuances', 'document_shares']) {
    const { error } = await supabase.from(table).delete().eq('document_id', documentId)
    if (error) return error
  }

  const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId)
  return deleteError
}

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/invite-user', requireUser, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Email không hợp lệ.' })
    return
  }

  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: publicSiteUrl,
  })

  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  res.json({ ok: true })
})

app.post('/api/update-profile-settings', requireUser, async (req, res) => {
  const currentUser = (req as AuthedRequest).user
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const fullName = String(req.body?.fullName ?? '').trim()

  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Email không hợp lệ.' })
    return
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      email,
      full_name: fullName || null,
    })
    .eq('id', currentUser.id)

  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  res.json({ ok: true })
})

app.post('/api/save-document', requireUser, async (req, res) => {
  const currentUser = (req as AuthedRequest).user
  const documentId = String(req.body?.documentId ?? '')
  const editing = Boolean(req.body?.editing)
  const document = req.body?.document as Record<string, unknown> | undefined

  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (!documentId || !document) {
    res.status(400).json({ error: 'Thiếu thông tin hồ sơ.' })
    return
  }

  const allowedTypes = new Set(['totrinh', 'quyetdinh', 'khenthuong', 'baocao', 'kehoach', 'banhanh'])
  const documentType = String(document.type ?? '')
  const title = String(document.title ?? '').trim()
  const description = String(document.description ?? '').trim()
  const documentYear = Number(document.document_year ?? new Date().getFullYear())
  const assigneeName = document.assignee_name ? String(document.assignee_name) : null
  const assigneeId = document.assignee_id ? String(document.assignee_id) : null

  if (!allowedTypes.has(documentType)) {
    res.status(400).json({ error: 'Loại hồ sơ không hợp lệ.' })
    return
  }

  if (!title || !description) {
    res.status(400).json({ error: 'Nội dung hồ sơ không được để trống.' })
    return
  }

  if (!Number.isInteger(documentYear) || documentYear < 2000 || documentYear > 2100) {
    res.status(400).json({ error: 'Năm hồ sơ không hợp lệ.' })
    return
  }

  const payload = {
    type: documentType,
    title,
    description,
    assignee_name: assigneeName,
    assignee_id: assigneeId,
    document_year: documentYear,
    status: 'archived',
  }

  if (editing) {
    const { data: existing, error: existingError } = await supabase
      .from('documents')
      .select('id,created_by')
      .eq('id', documentId)
      .single()

    if (existingError || !existing) {
      res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
      return
    }

    if (existing.created_by !== currentUser.id) {
      res.status(403).json({ error: 'Chỉ người tạo hồ sơ mới được sửa hồ sơ này.' })
      return
    }

    const { error } = await supabase
      .from('documents')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', documentId)

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }
  } else {
    const { error } = await supabase.from('documents').insert({
      id: documentId,
      ...payload,
      created_by: currentUser.id,
    })

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }
  }

  res.json({ ok: true, documentId })
})

app.post('/api/upload-document-file', requireUser, async (req, res) => {
  const currentUser = (req as AuthedRequest).user
  const documentId = String(req.body?.documentId ?? '')
  const name = String(req.body?.name ?? '').trim()
  const mimeType = String(req.body?.mimeType ?? 'application/octet-stream')
  const sizeBytes = Number(req.body?.sizeBytes ?? 0)
  const fileKind = String(req.body?.fileKind ?? 'attachment')
  const contentBase64 = String(req.body?.contentBase64 ?? '')

  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (!documentId || !name || !contentBase64) {
    res.status(400).json({ error: 'Thiếu thông tin file.' })
    return
  }

  if (!['attachment', 'issued_attachment'].includes(fileKind)) {
    res.status(400).json({ error: 'Loại file không hợp lệ.' })
    return
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 5 * 1024 * 1024) {
    res.status(400).json({ error: `File "${name}" vượt quá 5MB.` })
    return
  }

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,created_by,deleted_at')
    .eq('id', documentId)
    .single()

  if (documentError || !document || document.deleted_at) {
    res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
    return
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (document.created_by !== currentUser.id && profile?.role !== 'admin') {
    res.status(403).json({ error: 'Chỉ người tạo hồ sơ mới được thêm file.' })
    return
  }

  const fileBuffer = Buffer.from(contentBase64, 'base64')
  if (fileBuffer.byteLength === 0 || fileBuffer.byteLength > 5 * 1024 * 1024) {
    res.status(400).json({ error: `File "${name}" không hợp lệ hoặc vượt quá 5MB.` })
    return
  }

  const safeName = name.replace(/[^\w.-]+/g, '_')
  const objectPath = `${documentId}/${fileKind}/${randomUUID()}-${safeName}`
  const { error: uploadError } = await uploadDocumentObject(objectPath, fileBuffer, mimeType)

  if (uploadError) {
    res.status(400).json({ error: `Không lưu được file "${name}": ${uploadError.message}` })
    return
  }

  const filePayload = {
    document_id: documentId,
    name,
    object_path: objectPath,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    file_kind: fileKind,
    created_by: currentUser.id,
  }

  let fileInsert = await supabase
    .from('document_files')
    .insert(filePayload)
    .select('id')
    .single()

  if (fileInsert.error && fileInsert.error.message.toLowerCase().includes('file_kind')) {
    const { file_kind: _fileKind, ...fallbackPayload } = filePayload
    fileInsert = await supabase
      .from('document_files')
      .insert(fallbackPayload)
      .select('id')
      .single()
  }

  if (fileInsert.error) {
    await supabase.storage.from('documents').remove([objectPath])
    res.status(400).json({ error: `Không ghi được thông tin file "${name}": ${fileInsert.error.message}` })
    return
  }

  res.json({ ok: true, fileId: fileInsert.data.id, objectPath })
})

app.post('/api/delete-document-file', requireUser, async (req, res) => {
  const currentUser = (req as AuthedRequest).user
  const fileId = String(req.body?.fileId ?? '')

  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (!fileId) {
    res.status(400).json({ error: 'Thiếu mã file.' })
    return
  }

  const { data: file, error: fileError } = await supabase
    .from('document_files')
    .select('id,document_id,object_path,created_by,deleted_at')
    .eq('id', fileId)
    .single()

  if (fileError || !file || file.deleted_at) {
    res.status(404).json({ error: 'Không tìm thấy file.' })
    return
  }

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,created_by')
    .eq('id', file.document_id)
    .single()

  if (documentError || !document) {
    res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
    return
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  const allowed = profile?.role === 'admin' || document.created_by === currentUser.id || file.created_by === currentUser.id
  if (!allowed) {
    res.status(403).json({ error: 'Bạn không có quyền xóa file này.' })
    return
  }

  if (file.object_path) {
    const { error: storageError } = await supabase.storage.from('documents').remove([file.object_path])
    if (storageError) {
      res.status(400).json({ error: storageError.message })
      return
    }
  }

  const { error: updateError } = await supabase
    .from('document_files')
    .update({ deleted_at: new Date().toISOString(), deleted_by: currentUser.id })
    .eq('id', fileId)

  if (updateError) {
    res.status(400).json({ error: updateError.message })
    return
  }

  res.json({ ok: true })
})

app.post('/api/download-document-file', requireUser, async (req, res) => {
  const currentUser = (req as AuthedRequest).user
  const fileId = String(req.body?.fileId ?? '')

  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (!fileId) {
    res.status(400).json({ error: 'Thiếu mã file.' })
    return
  }

  const { data: file, error: fileError } = await supabase
    .from('document_files')
    .select('id,document_id,name,object_path,file_kind,mime_type,created_by,deleted_at')
    .eq('id', fileId)
    .single()

  if (fileError || !file || file.deleted_at) {
    res.status(404).json({ error: 'Không tìm thấy file.' })
    return
  }

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,created_by,assignee_id,deleted_at')
    .eq('id', file.document_id)
    .single()

  if (documentError || !document || document.deleted_at) {
    res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
    return
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  const { data: share } = await supabase
    .from('document_shares')
    .select('id')
    .eq('document_id', document.id)
    .eq('client_id', currentUser.id)
    .is('revoked_at', null)
    .maybeSingle()

  const allowed =
    profile?.role === 'admin' ||
    document.created_by === currentUser.id ||
    document.assignee_id === currentUser.id ||
    file.created_by === currentUser.id ||
    Boolean(share)

  if (!allowed) {
    res.status(403).json({ error: 'Bạn không có quyền tải file này.' })
    return
  }

  let objectPath = typeof file.object_path === 'string' ? file.object_path : null
  let downloaded = objectPath ? await downloadDocumentObject(objectPath) : { buffer: null, error: null }

  if (!downloaded.buffer) {
    const fallbackPath = await findExistingDocumentObject(
      file.document_id,
      typeof file.file_kind === 'string' ? file.file_kind : null,
      file.name,
      objectPath,
    )

    if (fallbackPath) {
      objectPath = fallbackPath
      downloaded = await downloadDocumentObject(fallbackPath)

      if (downloaded.buffer) {
        await supabase
          .from('document_files')
          .update({ object_path: fallbackPath })
          .eq('id', file.id)
      }
    }
  }

  if (!downloaded.buffer) {
    res.status(404).json({
      error: 'File không còn tồn tại trong Storage. Vui lòng xóa file này và upload lại.',
    })
    return
  }

  if (downloaded.buffer.byteLength === 0) {
    res.status(400).json({ error: 'File trong Storage đang rỗng. Vui lòng upload lại file.' })
    return
  }

  res.json({
    ok: true,
    name: file.name,
    mimeType: file.mime_type || 'application/octet-stream',
    contentBase64: downloaded.buffer.toString('base64'),
  })
})

app.post('/api/soft-delete-document', requireUser, async (req, res) => {
  const currentUser = (req as AuthedRequest).user
  const documentId = String(req.body?.documentId ?? '')

  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (!documentId) {
    res.status(400).json({ error: 'Thiếu mã hồ sơ.' })
    return
  }

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,created_by,deleted_at')
    .eq('id', documentId)
    .single()

  if (documentError || !document || document.deleted_at) {
    res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
    return
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  const allowed = profile?.role === 'admin' || document.created_by === currentUser.id
  if (!allowed) {
    res.status(403).json({ error: 'Chỉ người tạo hồ sơ mới được xóa hồ sơ này.' })
    return
  }

  const { error } = await supabase
    .from('documents')
    .update({ deleted_at: new Date().toISOString(), deleted_by: currentUser.id })
    .eq('id', documentId)

  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  res.json({ ok: true })
})

app.post('/api/setup-document-assignees', requireUser, async (req, res) => {
  const documentId = String(req.body?.documentId ?? '')
  const assignees = req.body?.assignees

  if (!documentId || !Array.isArray(assignees)) {
    res.status(400).json({ error: 'Thiếu thông tin hồ sơ hoặc danh sách người thực hiện.' })
    return
  }

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,title,type,created_by,assignee_id')
    .eq('id', documentId)
    .single()

  if (documentError || !document) {
    res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
    return
  }

  const currentUser = (req as AuthedRequest).user
  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (document.created_by !== currentUser.id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', currentUser.id)
      .single()
    if (profile?.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
  }

  // Thu hồi các lượt chia sẻ cũ trước khi tạo lượt chia sẻ mới
  await supabase
    .from('document_shares')
    .update({
      revoked_at: new Date().toISOString(),
      assigned_by: currentUser.id
    })
    .eq('document_id', documentId)
    .is('revoked_at', null)

  for (const assignee of assignees) {
    const email = String(assignee.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      continue
    }

    if (assignee.id) {
      // 1. Lưu thông tin chia sẻ tài liệu
      await supabase.from('document_shares').insert({
        document_id: documentId,
        client_id: assignee.id,
        assigned_by: currentUser.id
      })

      // 2. Tạo thông báo in-app (Bỏ qua người thực hiện chính vì DB trigger tự sinh)
      if (assignee.id !== document.assignee_id) {
        await supabase.from('notifications').insert({
          user_id: assignee.id,
          type: 'document_assigned',
          title: 'Bạn được giao hồ sơ',
          message: document.title,
          data: { documentId: document.id, type: document.type }
        })
      }

      // 3. Gửi email thông báo
      const name = assignee.name || assignee.email
      await sendMail(
        email,
        'Bạn được thêm vào hồ sơ',
        `<p>Xin chào ${name},</p>
         <p>Bạn vừa được thêm vào hồ sơ: <strong>${document.title}</strong>.</p>
         <p>Vui lòng truy cập hệ thống Lạc Hồng để xem chi tiết.</p>`
      )
    } else {
      // User chưa đăng ký
      // 1. Mời đăng ký qua Supabase Admin API
      try {
        await supabase.auth.admin.inviteUserByEmail(email, {
          redirectTo: publicSiteUrl,
        })
      } catch (err) {
        console.error('Error inviting user:', err)
      }

      // 2. Gửi email thông báo được giao hồ sơ + mời đăng ký
      await sendMail(
        email,
        'Lời mời tham gia hệ thống và phân công hồ sơ',
        `<p>Xin chào,</p>
         <p>Bạn vừa được mời tham gia vào hệ thống quản lý hồ sơ Lạc Hồng và được phân công thực hiện hồ sơ: <strong>${document.title}</strong>.</p>
         <p>Vui lòng kiểm tra hộp thư để tìm email có liên kết kích hoạt/đăng ký tài khoản và truy cập hệ thống để xem chi tiết.</p>`
      )
    }
  }

  res.json({ ok: true })
})

app.post('/api/delete-document-permanently', requireUser, async (req, res) => {
  const documentId = String(req.body?.documentId ?? '')
  const currentUser = (req as AuthedRequest).user

  if (!documentId) {
    res.status(400).json({ error: 'Thiếu mã hồ sơ.' })
    return
  }

  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,title,created_by,deleted_by,deleted_at')
    .eq('id', documentId)
    .single()

  if (documentError || !document) {
    res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
    return
  }

  if (!document.deleted_at) {
    res.status(400).json({ error: 'Chỉ có thể xóa vĩnh viễn hồ sơ trong thùng rác.' })
    return
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  const allowed = profile?.role === 'admin' || document.deleted_by === currentUser.id || document.created_by === currentUser.id
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const deleteError = await permanentlyDeleteDocument(documentId)
  if (deleteError) {
    res.status(400).json({ error: deleteError.message })
    return
  }

  res.json({ ok: true })
})

app.post('/api/delete-trash-documents', requireUser, async (req, res) => {
  const currentUser = (req as AuthedRequest).user

  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  let query = supabase
    .from('documents')
    .select('id')
    .not('deleted_at', 'is', null)

  if (profile?.role !== 'admin') {
    query = query.or(`deleted_by.eq.${currentUser.id},created_by.eq.${currentUser.id}`)
  }

  const { data: documents, error: listError } = await query
  if (listError) {
    res.status(400).json({ error: listError.message })
    return
  }

  for (const document of documents || []) {
    const deleteError = await permanentlyDeleteDocument(document.id)
    if (deleteError) {
      res.status(400).json({ error: deleteError.message })
      return
    }
  }

  res.json({ ok: true, deleted: documents?.length ?? 0 })
})

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.listen(port, () => {
  void ensureDocumentsBucket()
  console.log(`LacHong backend listening on ${port}`)
})
