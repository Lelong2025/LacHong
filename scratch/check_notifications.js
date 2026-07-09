const URL = 'https://inrokggcpuxrszmxegeg.supabase.co/rest/v1'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlucm9rZ2djcHV4cnN6bXhlZ2VnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzUwODQ4NCwiZXhwIjoyMDk5MDg0NDg0fQ.LFv9Q9bIq1K-Vl14eOq-Gpxr6pT02u1-J0n8z-uK9O8' // service_role key

async function check() {
  try {
    const res = await fetch(`${URL}/notifications?select=*&limit=1`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`
      }
    })
    const data = await res.json()
    console.log('Sample Notification:', data)
  } catch (err) {
    console.error(err)
  }
}

check()
