const SUPABASE_URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const URL = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`

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
