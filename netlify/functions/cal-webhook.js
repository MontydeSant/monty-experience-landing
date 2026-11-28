// netlify/functions/cal-webhook.js
// Recibe el webhook de Cal.com y avisa a Meta:
// (1) evento CAPI (Schedule) con deduplicacion por event_id
// (2) agrega al agendado a la audiencia "Agendaron llamada - Monty Experience"
//
// Regla de oro: ningun secreto vive en este archivo. Todo sale de
// process.env, configurado en Netlify (Site settings -> Environment variables).

const crypto = require('crypto');

const {
  sha256,
  normalizePhone,
  verifyCalSignature,
  sendCapiEvent,
  findOrCreateAudience,
  addUserToAudience,
} = require('./capi');

// Slugs de eventos de Cal.com que queremos rastrear. Cualquier otro tipo de
// evento se ignora (responde 200 igual, para que Cal.com no reintente).
const TRACKED_SLUGS = [
  'cafecito-monty-experiencer',
  '30min',
  '60min',
  'asesorias-metastar',
  'asesorias-metastar-artistas',
];

// Cal.com dispara BOOKING_CREATED cuando el evento NO requiere confirmacion
// manual, BOOKING_REQUESTED cuando si la requiere, y en algunos flujos
// tambien BOOKING_CREATED de nuevo al confirmarse. Tratamos todo esto como
// el mismo momento de intencion: alguien reservo/confirmo una llamada.
const TRACKED_TRIGGERS = ['BOOKING_CREATED', 'BOOKING_REQUESTED'];

const AUDIENCE_NAME = 'Agendaron llamada - Monty Experience';

// Slug del evento "Cafécito y Decisiones" (cal.com/montydesant/30min) -- el
// único que alimenta el Sheet de "Leads - Cafecitos". Los demás slugs de
// TRACKED_SLUGS siguen alimentando solo a Meta, como ya hacían.
const LEADS_SLUG = '30min';

// El campo responses.location de Cal.com puede venir como string u objeto
// segun el tipo de ubicacion (video, telefono, en persona, etc.). Meta exige
// que event_source_url sea siempre un string.
function resolveEventSourceUrl(booking) {
  const loc = booking.responses?.location?.value;
  if (typeof loc === 'string' && loc.startsWith('http')) return loc;
  return 'https://montyexperience.com';
}

// El navegador (assets/js/tracking.js) manda event_id, origen, fbp y fbc dentro
// de metadata[...] del embed de Cal.com. Cal los guarda en la reserva y los
// reenvia en el webhook como payload.metadata.*. Con el MISMO event_id, Meta
// deduplica el Schedule del navegador con el de este servidor (cuenta 1, no 2).
function leerMetadata(booking) {
  const m = (booking && booking.metadata) || {};
  const limpia = (v) => (typeof v === 'string' && v.length <= 200 ? v : null);
  return {
    eventId: limpia(m.eventId),
    origen: limpia(m.origen) || 'organico',
    fbp: limpia(m.fbp),
    fbc: limpia(m.fbc),
  };
}

// ---------------------------------------------------------------------------
// Google Sheets: fila nueva en "Leads - Cafecitos" (CRM de leads pre-venta)
// ---------------------------------------------------------------------------
// Reutiliza la MISMA cuenta de servicio que ya escribe en el Sheet de actores
// (GOOGLE_SERVICE_ACCOUNT_KEY), pero apunta a un archivo de Sheet aparte
// (GOOGLE_SHEET_ID_LEADS) para no mezclarlo con la plataforma pública de
// perfiles de actor, que vive en el Sheet de GOOGLE_SHEET_ID.

// Cal.com manda cada respuesta del formulario como { label, value } en
// versiones recientes, o como el valor plano en formularios más simples.
// Esto cubre ambos casos sin romperse.
function leerRespuesta(responses, key) {
  const r = responses && responses[key];
  if (r && typeof r === 'object' && 'value' in r) return r.value || '';
  return r || '';
}

// Clasificación automática Bellota / Fénix a partir de la respuesta libre de
// "¿Qué experiencia le llamó la atención?" en Cal.com. Es una inferencia de
// arranque -- Monty la puede corregir a mano desde el panel en cualquier
// momento (una vez corregida a mano, el panel deja de recalcularla sola).
function inferirSegmento(experienciaTexto) {
  const t = (experienciaTexto || '').toLowerCase();
  if (/f[eé]nix|elite/.test(t)) return 'Fénix';
  if (/classic/.test(t)) return 'Bellota';
  return '';
}

function formatearFechaCafecito(startTime) {
  if (!startTime) return '';
  const fecha = new Date(startTime);
  if (isNaN(fecha.getTime())) return '';
  return fecha.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// El evento "Cafécito y Decisiones" tiene "Requiere confirmación: Siempre"
// activado en Cal.com -- eso significa que CADA cita dispara el webhook DOS
// veces (BOOKING_REQUESTED al agendarse, BOOKING_CREATED al confirmarse).
// Para no duplicar la fila, cada reserva guarda su UID de Cal en la columna L
// (oculta a la vista normal) y aquí se revisa esa columna antes de escribir.
async function yaExisteEnSheet(sheetId, accessToken, bookingUid) {
  if (!bookingUid) return false;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    'Leads!L:L'
  )}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Sheets API (Leads, lectura UID) respondió ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const columna = json.values || [];
  return columna.some((fila) => (fila[0] || '').toString().trim() === bookingUid);
}

async function appendLeadToSheet(booking, attendee, bookingUid) {
  const credsRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID_LEADS;

  if (!credsRaw || !sheetId) {
    throw new Error('Faltan las variables GOOGLE_SERVICE_ACCOUNT_KEY o GOOGLE_SHEET_ID_LEADS en Netlify.');
  }

  const creds = JSON.parse(credsRaw);
  const accessToken = await getGoogleAccessToken(creds);

  if (await yaExisteEnSheet(sheetId, accessToken, bookingUid)) {
    return { ok: true, skipped: 'ya existía (duplicado de confirmación)' };
  }

  const responses = booking.responses || {};

  // Orden exacto de columnas del Sheet "Leads - Cafecitos", pestaña "Leads"
  // (A -> K visibles + L interna + M segmento). "Origen" y "Etapa" son las dos
  // columnas de seguimiento manual: Origen queda fijo en "Cal automático"
  // (esta fila nunca se escribe a mano) y Etapa arranca siempre en "Agendado"
  // -- Monty la va avanzando a mano desde el panel (Cafecito hecho -> Enviado
  // Pixieset -> Convertido/No por ahora). "Segmento" (M) arranca inferido de
  // la columna H (ver inferirSegmento) pero Monty lo puede corregir a mano
  // desde el panel en cualquier momento.
  const experienciaTexto = leerRespuesta(responses, 'experiencia');

  const row = [
    attendee.name || '', // A  Nombre
    attendee.email || '', // B  Correo
    attendee.phoneNumber || attendee.phone || '', // C  Celular
    formatearFechaCafecito(booking.startTime), // D  Fecha del cafecito
    leerRespuesta(responses, 'notes'), // E  Qué le ronda la cabeza
    leerRespuesta(responses, 'book'), // F  Hace cuánto no actualiza su book
    leerRespuesta(responses, 'casting'), // G  Casting en puerta
    experienciaTexto, // H  Experiencia que le llamó la atención
    leerRespuesta(responses, 'origen'), // I  Cómo llegó a Monty Experience
    'Cal automático', // J  Origen (de esta herramienta)
    'Agendado', // K  Etapa inicial
    bookingUid || '', // L  UID interno de Cal, solo para evitar duplicados
    inferirSegmento(experienciaTexto), // M  Segmento Bellota/Fénix (inferido; Monty puede corregirlo a mano)
  ];

  const range = 'Leads!A:M';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    range
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  });

  if (!res.ok) {
    throw new Error(`Sheets API (Leads) respondió ${res.status}: ${await res.text()}`);
  }

  return { ok: true };
}

// Firma un JWT con la cuenta de servicio y lo cambia por un access token
// OAuth2. Idéntico al que ya usa submission-created.js -- se duplica aquí
// para que cada función de Netlify siga siendo independiente y no dependa
// de las demás.
async function getGoogleAccessToken(creds) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const base64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const unsigned = `${base64url(header)}.${base64url(claims)}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(creds.private_key, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Token de Google (Leads) respondió ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  return json.access_token;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  const signature =
    event.headers['x-cal-signature-256'] || event.headers['X-Cal-Signature-256'];

  if (!verifyCalSignature(event.body, signature, secret)) {
    console.error('Firma de Cal.com invalida o ausente.');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (_e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const diagSlug = payload.payload?.eventType?.slug || payload.payload?.type || '(sin slug)';
  console.log(`[DIAG] triggerEvent=${payload.triggerEvent} slug=${diagSlug}`);

  if (!TRACKED_TRIGGERS.includes(payload.triggerEvent)) {
    return { statusCode: 200, body: `Ignored (trigger: ${payload.triggerEvent})` };
  }

  const booking = payload.payload || {};
  const slug = booking.eventType?.slug || booking.type || '';

  if (!TRACKED_SLUGS.includes(slug)) {
    console.log(`[DIAG] Slug no coincide con TRACKED_SLUGS: "${slug}". Si es un tipo de evento nuevo que quieres medir, agregalo a TRACKED_SLUGS.`);
    return { statusCode: 200, body: `Ignored (slug not tracked: ${slug})` };
  }

  const attendee = (booking.attendees && booking.attendees[0]) || {};
  const email = attendee.email || null;
  const phone = normalizePhone(attendee.phoneNumber || attendee.phone);
  const bookingUid = booking.uid || `${Date.now()}`;
  const meta = leerMetadata(booking);
  const eventId = meta.eventId || bookingUid;

  const hashedEmail = sha256(email);
  const hashedPhone = sha256(phone);

  // Paso 1: guardar el lead en "Leads - Cafecitos" -- solo para el cafecito
  // real, y SIN esperar a que Meta esté bien configurado (si faltan sus
  // variables más abajo, el lead ya quedó guardado de todos modos).
  if (slug === LEADS_SLUG) {
    try {
      const sheetResult = await appendLeadToSheet(booking, attendee, bookingUid);
      console.log(`[DIAG] Resultado Sheets (Leads): ${JSON.stringify(sheetResult)}`);
    } catch (err) {
      console.error('[cal-webhook] Error guardando en Google Sheets (Leads - Cafecitos):', err);
    }
  }

  const pixelId = process.env.META_PIXEL_ID;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !adAccountId || !accessToken) {
    console.error('Faltan variables de entorno META_PIXEL_ID / META_AD_ACCOUNT_ID / META_ACCESS_TOKEN.');
    // 500 (no 200) a proposito: asi el fallo aparece en rojo en Cal.com -> Webhooks
    // -> historial de envios, en vez de perderse en silencio en los logs de Netlify.
    return { statusCode: 500, body: 'Missing Meta env vars' };
  }

  console.log(`[DIAG] Enviando evento Schedule a Meta. event_id=${eventId} origen=${meta.origen} fbp=${meta.fbp ? 'si' : 'no'} fbc=${meta.fbc ? 'si' : 'no'}`);

  const capiResult = await sendCapiEvent({
    pixelId,
    accessToken,
    eventName: 'Schedule',
    eventId,
    fbp: meta.fbp,
    fbc: meta.fbc,
    eventSourceUrl: resolveEventSourceUrl(booking),
    userData: {
      em: hashedEmail ? [hashedEmail] : undefined,
      ph: hashedPhone ? [hashedPhone] : undefined,
    },
    customData: {
      content_name: slug,
      origen: meta.origen,
    },
  });

  console.log(`[DIAG] Resultado CAPI: ${JSON.stringify(capiResult)}`);

  const audienceId = await findOrCreateAudience({
    adAccountId,
    accessToken,
    name: AUDIENCE_NAME,
  });

  console.log(`[DIAG] audienceId: ${audienceId}`);

  if (audienceId) {
    const addResult = await addUserToAudience({
      audienceId,
      accessToken,
      hashedEmail,
      hashedPhone,
    });
    console.log(`[DIAG] Resultado add-user: ${JSON.stringify(addResult)}`);
  }

  return { statusCode: 200, body: 'OK' };
};
