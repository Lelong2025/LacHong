const URL = 'https://inrokggcpuxrszmxegeg.supabase.co/rest/v1'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlucm9rZ2djcHV4cnN6bXhlZ2VnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzUwODQ4NCwiZXhwIjoyMDk5MDg0NDg0fQ.LFvGfgpyaFhGnS5jivyNSmmzah17HdiNmUgCs1yrCDI'

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
