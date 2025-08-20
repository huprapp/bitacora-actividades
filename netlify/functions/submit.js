// netlify/functions/submit.js
export async function handler(event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const url = process.env.SHEETS_WEBAPP_URL || '';

  if (event.httpMethod === 'GET') {
    try {
      // Si piden action=list, reenviamos con los mismos query params
      if (url && event.queryStringParameters && event.queryStringParameters.action) {
        const qs = event.rawQuery ? `?${event.rawQuery}` : '';
        const r = await fetch(url + qs, { method: 'GET' });
        const t = await r.text();
        return { statusCode: r.status, headers: { ...cors, 'Content-Type': 'application/json' }, body: t };
      }
      // Ping/health (sin action)
      let probe = null;
      if (url) {
        try {
          const r = await fetch(url, { method: 'GET' });
          const txt = await r.text();
          probe = { status: r.status, sample: txt.slice(0, 500) };
        } catch (e) {
          probe = { error: String(e) };
        }
      }
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, hasUrl: !!url, url, probe }) };
    } catch (e) {
      return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error:String(e) }) };
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      if (!url) return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'Missing SHEETS_WEBAPP_URL env' }) };
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: event.body });
      const text = await resp.text();
      return { statusCode: resp.status, headers: { ...cors, 'Content-Type': 'application/json' }, body: text };
    } catch (e) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:String(e) }) };
    }
  }

  return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
}
