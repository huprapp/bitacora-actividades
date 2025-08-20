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

  if (event.httpMethod === 'GET') {
    // Ping de diagnóstico: confirma env var y (opcional) prueba GET al Apps Script
    const url = process.env.SHEETS_WEBAPP_URL || '';
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
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, hasUrl: !!url, url, probe }),
    };
  }

  if (event.httpMethod === 'POST') {
    try {
      const url = process.env.SHEETS_WEBAPP_URL;
      if (!url) {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'Missing SHEETS_WEBAPP_URL env' }) };
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: event.body,
      });
      const text = await resp.text();
      return {
        statusCode: resp.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: text,
      };
    } catch (e) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: String(e) }) };
    }
  }

  return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
}
