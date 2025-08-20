export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }
  try {
    const url = process.env.SHEETS_WEBAPP_URL
    if (!url) return { statusCode: 500, body: 'Missing SHEETS_WEBAPP_URL env' }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: event.body,
    })

    const text = await resp.text()
    return { statusCode: resp.status, headers: { 'Content-Type': 'application/json' }, body: text }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok:false, error:String(e) }) }
  }
}
