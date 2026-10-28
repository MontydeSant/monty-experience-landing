// netlify/functions/capi-web.js
//
// Relevo de eventos del navegador hacia la API de Conversiones de Meta (CAPI).
// Hoy solo lo usa el evento Lead (clic en WhatsApp): si el visitante bloquea el
// Pixel o usa un iPhone con protección de rastreo, el evento igual llega por aquí.
// Pixel y servidor mandan el MISMO event_id y Meta lo cuenta una sola vez.
//
// Variables de entorno (ya existentes para cal-webhook): META_PIXEL_ID, META_ACCESS_TOKEN.
// Nada secreto vive en este archivo.

const GRAPH_VERSION = 'v21.0';

// Solo se aceptan eventos de páginas de este sitio, así nadie puede usar la
// función desde afuera para ensuciar el Pixel con eventos falsos.
const HOSTS_PERMITIDOS = ['montyexperience.com', 'www.montyexperience.com'];

// Lista cerrada de eventos que este relevo acepta (evita abuso y gasto de créditos).
const EVENTOS_PERMITIDOS = ['Lead'];

function hostDe(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.error('[capi-web] Faltan META_PIXEL_ID o META_ACCESS_TOKEN en Netlify.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Configuración incompleta' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { event_name, event_id, event_source_url, fbp, fbc, custom_data } = body;

  if (!EVENTOS_PERMITIDOS.includes(event_name) || !event_id || String(event_id).length > 120) {
    return { statusCode: 400, body: JSON.stringify({ error: 'event_name o event_id inválido' }) };
  }
  if (!HOSTS_PERMITIDOS.includes(hostDe(event_source_url))) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Origen no permitido' }) };
  }

  const headers = event.headers || {};
  const clientIp =
    headers['x-nf-client-connection-ip'] ||
    (headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    undefined;

  const userData = {
    client_ip_address: clientIp,
    client_user_agent: headers['user-agent'],
  };
  if (fbp) userData.fbp = String(fbp).slice(0, 200);
  if (fbc) userData.fbc = String(fbc).slice(0, 200);

  // custom_data: solo valores simples, para no reenviar nada raro a Meta.
  let customData;
  if (custom_data && typeof custom_data === 'object') {
    customData = {};
    Object.keys(custom_data).slice(0, 15).forEach((k) => {
      const v = custom_data[k];
      if (['string', 'number', 'boolean'].includes(typeof v)) {
        customData[k] = typeof v === 'string' ? v.slice(0, 200) : v;
      }
    });
  }

  const payload = {
    data: [
      {
        event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: String(event_id),
        event_source_url,
        action_source: 'website',
        user_data: userData,
        ...(customData && Object.keys(customData).length ? { custom_data: customData } : {}),
      },
    ],
  };

  try {
    // El token va en el encabezado, no en la URL, para que no quede en logs.
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.error('[capi-web] Error CAPI Meta:', JSON.stringify(data));
    return { statusCode: res.ok ? 200 : 400, body: JSON.stringify({ ok: res.ok }) };
  } catch (err) {
    console.error('[capi-web] Error llamando a CAPI:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'fallo de red' }) };
  }
};
