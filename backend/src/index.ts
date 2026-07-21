import cors from 'cors'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
import express from 'express'
import nodemailer from 'nodemailer'
import WebSocket from 'ws'
import { createClient, type User } from '@supabase/supabase-js'
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary'

dotenv.config()
dotenv.config({ path: '../.env' })

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const app = express()
const port = Number(process.env.PORT ?? 3001)
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? '*'
const publicSiteUrl = process.env.PUBLIC_SITE_URL ?? frontendOrigin
const siteUrl = publicSiteUrl.endsWith('/') ? publicSiteUrl : `${publicSiteUrl}/`
const inviteRedirectUrl = (() => {
  try {
    const url = new URL(siteUrl)
    url.searchParams.set('next', 'settings')
    return url.toString()
  } catch {
    return siteUrl
  }
})()
const normalizeOrigin = (origin: string) => {
  try {
    return new URL(origin).origin
  } catch {
    return origin
  }
}
const allowedOrigins = new Set(
  [
    ...frontendOrigin.split(',').map((origin) => origin.trim()).filter(Boolean).map(normalizeOrigin),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://lelong2025.github.io',
  ].filter((origin) => origin !== '*'),
)

const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
})

cloudinary.config({
  cloud_name: required('CLOUDINARY_CLOUD_NAME'),
  api_key: required('CLOUDINARY_API_KEY'),
  api_secret: required('CLOUDINARY_API_SECRET'),
  secure: true,
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

async function ensureProfileForUser(user: User) {
  const email = String(user.email || '').trim().toLowerCase()
  if (!email) return { profile: null, error: new Error('Missing user email') }

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id,email,full_name,role,is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (existingProfile) return { profile: existingProfile, error: null }

  await supabase
    .from('profiles')
    .update({
      email: `${email}.orphan.${user.id.replace(/-/g, '')}@local`,
      updated_at: new Date().toISOString(),
    })
    .eq('email', email)
    .neq('id', user.id)

  const fullName = typeof user.user_metadata?.full_name === 'string'
    ? user.user_metadata.full_name.trim()
    : ''

  const { data: profile, error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      email,
      full_name: fullName || null,
      role: 'client',
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .select('id,email,full_name,role,is_active')
    .single()

  if (!error) {
    await claimPendingDocumentShares(user.id)
  }

  return { profile, error }
}

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

  const { profile, error: profileError } = await ensureProfileForUser(data.user)

  if (profileError || !profile?.is_active) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  req.user = data.user
  next()
}

async function sendMail(to: string, subject: string, html: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${required('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: required('MAIL_FROM'),
      to,
      subject,
      html,
    }),
  })

  const data = await response.json().catch(() => null) as { id?: string; message?: string; error?: string } | null
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Resend returned ${response.status}`)
  }

  return { messageId: data?.id || null }
}

function sendMailInBackground(to: string, subject: string, html: string) {
  console.log(`Queueing mail to ${to}: ${subject}`)
  void sendMail(to, subject, html)
    .then((info) => {
      console.log(`Mail sent to ${to}: ${info.messageId || 'accepted by SMTP'}`)
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Unable to send mail to ${to}: ${message}`)
    })
}

function envValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return ''
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendAssignmentMailWithLog4Net(to: string, subject: string, html: string) {
  const email = envValue('GmailSettings__Mail', 'GmailSettings:Mail', 'GMAIL_MAIL', 'GMAIL_USER', 'SMTP_USER')
  const password = envValue('GmailSettings__Password', 'GmailSettings:Password', 'GMAIL_PASSWORD', 'GMAIL_APP_PASSWORD', 'SMTP_PASSWORD', 'SMTP_PASS')
  const host = envValue('GmailSettings__Host', 'GmailSettings:Host', 'GMAIL_HOST', 'SMTP_HOST') || 'smtp.gmail.com'
  const port = Number(envValue('GmailSettings__Port', 'GmailSettings:Port', 'GMAIL_PORT', 'SMTP_PORT') || 587)
  const fromAddress = envValue('GmailSettings__From', 'GmailSettings:From', 'MAIL_FROM', 'SMTP_FROM') || email
  const fromName = envValue('GmailSettings__FromName', 'GmailSettings:FromName', 'SMTP_FROM_NAME')
  const from = fromName ? `"${fromName.replace(/"/g, '\\"')}" <${fromAddress}>` : fromAddress
  const secureValue = envValue('GmailSettings__Secure', 'GmailSettings:Secure', 'GMAIL_SECURE', 'SMTP_SECURE').toLowerCase()

  if (!email || !password) {
    throw new Error('Missing GmailSettings mail/password for log4net assignment mail')
  }

  const mailer = nodemailer.createTransport({
    host,
    port,
    secure: secureValue ? ['1', 'true', 'yes'].includes(secureValue) : port === 465,
    auth: {
      user: email,
      pass: password,
    },
  })

  return mailer.sendMail({
    from,
    to,
    subject,
    html,
  })
}

function sendAssignmentMailWithLog4NetInBackground(to: string, subject: string, html: string) {
  console.info(`[log4net] Queueing assignment mail to ${to}: ${subject}`)
  void sendAssignmentMailWithLog4Net(to, subject, html)
    .then((info) => {
      console.info(`[log4net] Assignment mail sent to ${to}: ${info.messageId || 'accepted by SMTP'}`)
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[log4net] Unable to send assignment mail to ${to}: ${message}`)
    })
}

const documentTypeLabels: Record<string, string> = {
  totrinh: 'Tờ trình',
  quyetdinh: 'Quyết định',
  khenthuong: 'Khen thưởng',
  baocao: 'Báo cáo',
  kehoach: 'Kế hoạch',
}

function buildAssignmentMailHtml(params: { assigneeName: string; documentTitle: string; documentType: string }) {
  const assigneeName = escapeHtml(params.assigneeName)
  const documentTitle = escapeHtml(params.documentTitle)
  const documentType = escapeHtml(documentTypeLabels[params.documentType] || params.documentType)
  const detailsUrl = escapeHtml(siteUrl)

  return `<div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; background-color: #f4f7fb; color: #152033;">
    <div style="background-color: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #dbe4f0;">
      <div style="background-color: #1f5fa8; padding: 22px 28px; color: #ffffff;">
        <div style="font-size: 13px; letter-spacing: .04em; text-transform: uppercase; opacity: .9;">Trung Tâm Nghiên Cứu Khoa Học &amp; Ứng Dụng</div>
        <h1 style="font-size: 22px; line-height: 1.35; margin: 8px 0 0;">Bạn đã được thêm vào hồ sơ mới</h1>
      </div>
      <div style="padding: 28px;">
        <p style="font-size: 16px; line-height: 1.65; margin: 0 0 14px;">Xin chào <strong>${assigneeName}</strong>,</p>
        <p style="font-size: 15px; line-height: 1.65; margin: 0 0 20px; color: #46556a;">
          Bạn vừa được thêm vào danh sách người thực hiện của hồ sơ dưới đây.
        </p>
        <div style="background-color: #eef5ff; border-left: 4px solid #1f5fa8; border-radius: 6px; padding: 16px 18px; margin: 0 0 22px;">
          <div style="font-size: 12px; text-transform: uppercase; color: #1f5fa8; font-weight: 700; margin-bottom: 6px;">Hồ sơ</div>
          <div style="font-size: 17px; line-height: 1.5; font-weight: 700; color: #111827;">${documentTitle}</div>
          <div style="font-size: 13px; color: #607089; margin-top: 8px;">Loại hồ sơ: ${documentType}</div>
        </div>
        <p style="font-size: 15px; line-height: 1.65; margin: 0 0 26px; color: #46556a;">
          Vui lòng truy cập hệ thống để xem chi tiết hồ sơ và các tài liệu liên quan.
        </p>
        <div style="text-align: center;">
          <a href="${detailsUrl}" style="background-color: #1f5fa8; color: #ffffff; display: inline-block; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 15px;">
            Xem hồ sơ
          </a>
        </div>
      </div>
    </div>
    <p style="text-align: center; color: #7a8797; font-size: 12px; line-height: 1.5; margin: 18px 0 0;">
      Đây là email tự động từ hệ thống. Vui lòng không phản hồi email này.
    </p>
  </div>`
}

const cloudinaryPathPrefix = 'cloudinary:'

const isCloudinaryPath = (objectPath: string) => objectPath.startsWith(cloudinaryPathPrefix)
const toCloudinaryPublicId = (objectPath: string) => objectPath.slice(cloudinaryPathPrefix.length)

function splitRawPublicId(publicId: string) {
  const lastSlash = publicId.lastIndexOf('/')
  const lastDot = publicId.lastIndexOf('.')
  if (lastDot <= lastSlash || lastDot === publicId.length - 1) {
    return { publicId, format: 'bin' }
  }

  return {
    publicId: publicId.slice(0, lastDot),
    format: publicId.slice(lastDot + 1).toLowerCase(),
  }
}

async function uploadDocumentObject(publicId: string, fileBuffer: Buffer) {
  return new Promise<{ objectPath: string | null; error: Error | null }>((resolve) => {
    const upload = cloudinary.uploader.upload_stream({
      resource_type: 'raw',
      type: 'authenticated',
      public_id: publicId,
      overwrite: false,
    }, (error, result: UploadApiResponse | undefined) => {
      if (error || !result) {
        resolve({ objectPath: null, error: new Error(error?.message || 'Cloudinary upload failed') })
        return
      }

      resolve({ objectPath: `${cloudinaryPathPrefix}${result.public_id}`, error: null })
    })

    upload.end(fileBuffer)
  })
}

const toSafeStorageName = (name: string) => name.replace(/[^\w.-]+/g, '_')

async function downloadDocumentObject(objectPath: string) {
  if (isCloudinaryPath(objectPath)) {
    try {
      const rawAsset = splitRawPublicId(toCloudinaryPublicId(objectPath))
      const downloadUrl = cloudinary.utils.private_download_url(rawAsset.publicId, rawAsset.format, {
        resource_type: 'raw',
        type: 'authenticated',
        expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
      })
      const response = await fetch(downloadUrl)
      if (!response.ok) {
        const details = await response.text().catch(() => '')
        return {
          buffer: null,
          error: new Error(`Cloudinary returned ${response.status}${details ? `: ${details.slice(0, 200)}` : ''}`),
        }
      }
      return { buffer: Buffer.from(await response.arrayBuffer()), error: null }
    } catch (error) {
      return { buffer: null, error: error instanceof Error ? error : new Error(String(error)) }
    }
  }

  const { data, error } = await supabase.storage.from('documents').download(objectPath)
  if (error || !data) return { buffer: null, error }

  const arrayBuffer = await data.arrayBuffer()
  return { buffer: Buffer.from(arrayBuffer), error: null }
}

async function deleteDocumentObject(objectPath: string) {
  if (isCloudinaryPath(objectPath)) {
    try {
      const result = await cloudinary.uploader.destroy(toCloudinaryPublicId(objectPath), {
        resource_type: 'raw',
        type: 'authenticated',
        invalidate: true,
      })
      if (!['ok', 'not found'].includes(result.result)) return new Error(`Cloudinary delete failed: ${result.result}`)
      return null
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  }

  const { error } = await supabase.storage.from('documents').remove([objectPath])
  return error
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
    for (const objectPath of objectPaths) {
      const storageError = await deleteDocumentObject(objectPath)
      if (storageError) return storageError
    }
  }

  for (const table of ['document_files', 'document_versions', 'review_actions', 'issuances', 'document_shares']) {
    const { error } = await supabase.from(table).delete().eq('document_id', documentId)
    if (error) return error
  }

  const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId)
  return deleteError
}

async function getCurrentProfile(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('id,email,full_name,role,is_active')
    .eq('id', userId)
    .single()

  return data
}

async function claimPendingDocumentShares(profileId: string) {
  const { error } = await supabase.rpc('claim_pending_document_shares_for_profile', {
    p_profile_id: profileId,
  })

  if (error) {
    console.error('Unable to claim pending document shares:', error.message)
  }
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
    redirectTo: inviteRedirectUrl,
  })

  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  res.json({ ok: true })
})

app.post('/api/test-mail', requireUser, async (req, res) => {
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

  if (profile?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const email = String(req.body?.email ?? currentUser.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Email không hợp lệ.' })
    return
  }

  try {
    const info = await sendMail(
      email,
      '[Lạc Hồng] Kiểm tra gửi mail',
      '<p>Email kiểm tra từ hệ thống Lạc Hồng.</p>',
    )
    res.json({ ok: true, messageId: info.messageId || null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không gửi được email.'
    res.status(500).json({ error: message })
  }
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
      email: email,
      full_name: fullName.trim() || null,
    })
    .eq('id', currentUser.id)

  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  await claimPendingDocumentShares(currentUser.id)

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

  const allowedTypes = new Set(['totrinh', 'quyetdinh', 'khenthuong', 'baocao', 'kehoach'])
  const documentType = String(document.type ?? '')
  const title = String(document.title ?? '').trim()
  const description = String(document.description ?? '').trim()
  const documentYear = Number(document.document_year ?? new Date().getFullYear())
  const assigneeName = document.assignee_name ? String(document.assignee_name) : null
  const assigneeId = document.assignee_id ? String(document.assignee_id) : null
  const requestedStatus = String(document.status ?? 'pending_issue')

  if (!allowedTypes.has(documentType)) {
    res.status(400).json({ error: 'Loại hồ sơ không hợp lệ.' })
    return
  }

  if (!description) {
    res.status(400).json({ error: 'Nội dung hồ sơ không được để trống.' })
    return
  }

  if (!Number.isInteger(documentYear) || documentYear < 2000 || documentYear > 2100) {
    res.status(400).json({ error: 'Năm hồ sơ không hợp lệ.' })
    return
  }

  if (!['pending_issue', 'issued'].includes(requestedStatus)) {
    res.status(400).json({ error: 'Tình trạng hồ sơ không hợp lệ.' })
    return
  }

  let nextStatus = requestedStatus

  const payload = {
    type: documentType,
    title,
    description,
    assignee_name: assigneeName,
    assignee_id: assigneeId,
    document_year: documentYear,
    status: nextStatus,
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

    if (nextStatus === 'pending_issue') {
      const { data: existingIssuedFiles } = await supabase
        .from('document_files')
        .select('id')
        .eq('document_id', documentId)
        .eq('file_kind', 'issued_attachment')
        .is('deleted_at', null)
        .limit(1)
      if ((existingIssuedFiles || []).length > 0) nextStatus = 'issued'
      payload.status = nextStatus
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
  const publicId = `documents/${documentId}/${fileKind}/${randomUUID()}-${safeName}`
  const { objectPath, error: uploadError } = await uploadDocumentObject(publicId, fileBuffer)

  if (uploadError || !objectPath) {
    res.status(400).json({ error: `Không lưu được file "${name}": ${uploadError?.message || 'Cloudinary không trả về đường dẫn file.'}` })
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
    await deleteDocumentObject(objectPath)
    res.status(400).json({ error: `Không ghi được thông tin file "${name}": ${fileInsert.error.message}` })
    return
  }

  if (fileKind === 'issued_attachment') {
    await supabase
      .from('documents')
      .update({ status: 'issued', updated_at: new Date().toISOString() })
      .eq('id', documentId)
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
    .select('id,document_id,object_path,created_by,deleted_at,file_kind')
    .eq('id', fileId)
    .single()

  if (fileError || !file || file.deleted_at) {
    res.status(404).json({ error: 'Không tìm thấy thông tin file trong cơ sở dữ liệu.', code: 'FILE_RECORD_NOT_FOUND' })
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
    const storageError = await deleteDocumentObject(file.object_path)
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

  if (file.file_kind === 'issued_attachment') {
    const { data: remainingIssuedFiles } = await supabase
      .from('document_files')
      .select('id')
      .eq('document_id', file.document_id)
      .eq('file_kind', 'issued_attachment')
      .is('deleted_at', null)
      .limit(1)
    if (!(remainingIssuedFiles || []).length) {
      await supabase
        .from('documents')
        .update({ status: 'pending_issue', updated_at: new Date().toISOString() })
        .eq('id', file.document_id)
    }
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
    res.status(404).json({ error: 'Không tìm thấy thông tin file trong cơ sở dữ liệu.', code: 'FILE_RECORD_NOT_FOUND' })
    return
  }

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,created_by,assignee_id,deleted_at')
    .eq('id', file.document_id)
    .single()

  if (documentError || !document || document.deleted_at) {
    res.status(404).json({ error: 'Không tìm thấy hồ sơ chứa file hoặc hồ sơ đã bị xóa.', code: 'DOCUMENT_NOT_FOUND' })
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

  if (!downloaded.buffer && (!objectPath || !isCloudinaryPath(objectPath))) {
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
    if (downloaded.error) console.error(`Unable to download document file ${file.id}:`, downloaded.error.message)
    res.status(502).json({
      error: downloaded.error
        ? `Cloudinary không trả được file: ${downloaded.error.message}`
        : 'Không tìm thấy đường dẫn file trong nơi lưu trữ.',
      code: 'STORAGE_DOWNLOAD_FAILED',
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

app.post('/api/list-trash-documents', requireUser, async (req, res) => {
  const currentUser = (req as AuthedRequest).user
  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const profile = await getCurrentProfile(currentUser.id)

  let query = supabase
    .from('documents')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })

  if (profile?.role !== 'admin') {
    query = query.or(`deleted_by.eq.${currentUser.id},created_by.eq.${currentUser.id}`)
  }

  const { data, error } = await query
  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  res.json({ ok: true, documents: data || [] })
})

app.post('/api/restore-document', requireUser, async (req, res) => {
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
    .select('id,created_by,deleted_by,deleted_at')
    .eq('id', documentId)
    .single()

  if (documentError || !document) {
    res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
    return
  }

  if (!document.deleted_at) {
    res.status(400).json({ error: 'Hồ sơ này không nằm trong thùng rác.' })
    return
  }

  const profile = await getCurrentProfile(currentUser.id)
  const allowed = profile?.role === 'admin' || document.deleted_by === currentUser.id || document.created_by === currentUser.id
  if (!allowed) {
    res.status(403).json({ error: 'Bạn không có quyền khôi phục hồ sơ này.' })
    return
  }

  const { error } = await supabase
    .from('documents')
    .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() })
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

    let assigneeId = assignee.id ? String(assignee.id) : ''
    let assigneeName = assignee.name ? String(assignee.name) : ''

    if (!assigneeId) {
      const { data: matchedProfile } = await supabase
        .from('profiles')
        .select('id,email,full_name,is_active')
        .eq('email', email)
        .eq('is_active', true)
        .maybeSingle()

      assigneeId = matchedProfile?.id || ''
      assigneeName = assigneeName || matchedProfile?.full_name || ''
    }

    if (assigneeId) {
      // 1. Lưu thông tin chia sẻ tài liệu
      const { data: existingShare, error: existingShareError } = await supabase
        .from('document_shares')
        .select('id')
        .eq('document_id', documentId)
        .or(`client_id.eq.${assigneeId},shared_with.eq.${assigneeId}`)
        .maybeSingle()

      if (existingShareError) {
        res.status(400).json({ error: `Không thể kiểm tra phân quyền cho ${email}: ${existingShareError.message}` })
        return
      }

      const sharePayload = {
        client_id: assigneeId,
        shared_with: assigneeId,
        shared_by: currentUser.id,
        assigned_by: currentUser.id,
        pending_email: null,
        revoked_at: null,
      }

      const { error: shareError } = existingShare
        ? await supabase.from('document_shares').update(sharePayload).eq('id', existingShare.id)
        : await supabase.from('document_shares').insert({
          document_id: documentId,
          ...sharePayload,
        })

      if (shareError) {
        res.status(400).json({ error: `Không thể gắn hồ sơ cho ${email}: ${shareError.message}` })
        return
      }

      // 2. Tạo thông báo in-app (Bỏ qua người thực hiện chính vì DB trigger tự sinh)
      if (assigneeId !== document.assignee_id) {
        await supabase.from('notifications').insert({
          user_id: assigneeId,
          type: 'document_assigned',
          title: 'Bạn được giao hồ sơ',
          message: document.title,
          data: { documentId: document.id, type: document.type }
        })
      }

      // 3. Gửi email thông báo
      const name = assigneeName || assignee.email
      sendAssignmentMailWithLog4NetInBackground(
        email,
        '[Lạc Hồng] Bạn đã được thêm vào hồ sơ mới',
        buildAssignmentMailHtml({
          assigneeName: name,
          documentTitle: document.title,
          documentType: document.type,
        })
      )
    } else {
      // User chưa đăng ký
      // 1. Lưu quyền chờ theo email để khi tài khoản được tạo sẽ tự thấy hồ sơ
      const { data: existingPendingShare, error: existingPendingShareError } = await supabase
        .from('document_shares')
        .select('id')
        .eq('document_id', documentId)
        .eq('pending_email', email)
        .maybeSingle()

      if (existingPendingShareError) {
        res.status(400).json({ error: `Không thể kiểm tra phân quyền chờ cho ${email}: ${existingPendingShareError.message}` })
        return
      }

      const pendingSharePayload = {
        client_id: null,
        shared_with: null,
        pending_email: email,
        assigned_by: currentUser.id,
        shared_by: currentUser.id,
        revoked_at: null,
      }

      const { error: pendingShareError } = existingPendingShare
        ? await supabase.from('document_shares').update(pendingSharePayload).eq('id', existingPendingShare.id)
        : await supabase.from('document_shares').insert({
          document_id: documentId,
          ...pendingSharePayload,
        })

      if (pendingShareError) {
        res.status(400).json({ error: `Không thể gắn hồ sơ chờ cho ${email}: ${pendingShareError.message}` })
        return
      }

      // 2. Mời đăng ký qua Supabase Admin API
      try {
        await supabase.auth.admin.inviteUserByEmail(email, {
          redirectTo: inviteRedirectUrl,
        })
      } catch (err) {
        console.error('Error inviting user:', err)
      }

      // 3. Gửi email thông báo được giao hồ sơ + mời đăng ký
      sendMailInBackground(
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
  console.log(`LacHong backend listening on ${port}`)
})
