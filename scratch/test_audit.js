const SUPABASE_URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const URL = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`

async function test() {
  try {
    console.log('Gọi RPC log_login...')
    const res = await fetch(`${URL}/rpc/log_login`, {
      method: 'POST',
      headers: {
        'apikey': KEY,
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })
    
    console.log('Trạng thái phản hồi:', res.status)
    const text = await res.text()
    console.log('Nội dung phản hồi:', text)

    // Select lại bảng audit_logs xem có bản ghi nào chưa
    const resLogs = await fetch(`${URL}/audit_logs?select=*`, {
      headers: {
        'apikey': KEY,
        'Authorization': `Bearer ${KEY}`
      }
    })
    const logs = await resLogs.json()
    console.log('Bảng audit_logs sau khi gọi RPC:', logs)
  } catch (err) {
    console.error('Lỗi:', err)
  }
}

test()
