import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve('e:/LacHong/backend/.env') })

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

async function test() {
  try {
    console.log('Đang gửi mail thử...')
    await mailer.sendMail({
      from: {
        name: process.env.SMTP_FROM_NAME ?? 'He thong Lac Hong',
        address: process.env.SMTP_FROM,
      },
      to: 'vonhacphuoc@gmail.com',
      subject: 'Test email Lac Hong',
      html: '<p>Đây là mail test hệ thống.</p>',
    })
    console.log('Gửi mail thành công!')
  } catch (err) {
    console.error('Gửi mail thất bại:', err)
  }
}

test()
