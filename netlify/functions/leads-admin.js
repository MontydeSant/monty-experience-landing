// netlify/functions/leads-admin.js
//
// Backend del panel de leads (admin/index.html). Lee y actualiza el Google
// Sheet "Leads - Cafecitos" sin exponer nunca la contraseña ni la cuenta de
// servicio de Google al navegador -- todo pasa por aquí. El navegador solo
// manda la contraseña en cada request; esta función la valida contra
// ADMIN_PASSWORD (Netlify -> Site configuration -> Environment variables)
// antes de leer o escribir nada.
//
// Variables de entorno requeridas:
// - ADMIN_PASSWORD             -> contraseña del panel (secreta)
// - GOOGLE_SERVICE_ACCOUNT_KEY -> misma cuenta de servicio que cal-webhook.js
// - GOOGLE_SHEET_ID_LEADS      -> ID del Sheet "Leads - Cafecitos"
//
// (Redeploy sin cambios de lógica: para que esta función recoja el valor de
// ADMIN_PASSWORD agregado después del deploy anterior.)

const crypto = require('crypto');

const SHEET_TAB = 'Leads';
const ETAPAS_VALIDAS = ['Agendado', 'Cafecito hecho', 'Enviado Pixieset', 'Convertido', 'No por ahora'];
const SEGMENTOS_VALIDOS = ['Bellota', 'Fénix', '']; // '' = sin clasificar / se resetea a inferencia automática

// Misma inferencia que cal-webhook.js (ver comentario ahí) -- se usa aquí
// como respaldo para leads que ya existían en el Sheet antes de que se
// agregara la columna M, o para cualquiera que se quede sin segmento guardado.
function inferirSegmento(experienciaTexto) {
  const t = (experienciaTexto || '').toLowerCase();
  if (/f[eé]nix|elite/.test(t)) return 'Fénix';
  if (/classic/.test(t)) return 'Bellota';
  return '';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return json(400, { error: 'JSON inválido' });
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('[leads-admin] Falta la variable ADMIN_PASSWORD en Netlify.');
    return json(500, { error: 'El panel todavía no está configurado (falta ADMIN_PASSWORD).' });
  }

  if (!body.password || !passwordCorrecta(body.password, adminPassword)) {
    return json(401, { error: 'Contraseña incorrecta' });
  }

  try {
    if (body.action === 'update-etapa') {
      return await actualizarEtapa(body);
    }
    if (body.action === 'update-segmento') {
      return await actualizarSegmento(body);
    }
    if (body.action === 'update-notas') {
      return await actualizarNotaInterna(body);
    }
    return await listarLeads();
  } catch (err) {
    console.error('[leads-admin] Error:', err);
    return json(500, { error: 'Error interno -- revisa los logs de la función en Netlify.' });
  }
};

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

// Comparación a tiempo constante para no filtrar la contraseña por timing.
function passwordCorrecta(intento, real) {
  const a = Buffer.from(String(intento));
  const b = Buffer.from(String(real));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function getSheetAccess() {
  const credsRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID_LEADS;
  if (!credsRaw || !sheetId) {
    throw new Error('Faltan las variables GOOGLE_SERVICE_ACCOUNT_KEY o GOOGLE_SHEET_ID_LEADS en Netlify.');
  }
  const creds = JSON.parse(credsRaw);
  const accessToken = await getGoogleAccessToken(creds);
  return { sheetId, accessToken };
}

// ---------------------------------------------------------------------------
// Listar leads
// ---------------------------------------------------------------------------

async function listarLeads() {
  const { sheetId, accessToken } = await getSheetAccess();
  const range = `${SHEET_TAB}!A2:N`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Sheets API respondió ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const filas = data.values || [];

  const leads = filas
    .map((fila, i) => ({
      rowIndex: i + 2, // fila real en el Sheet (encabezado = fila 1)
      nombre: fila[0] || '',
      correo: fila[1] || '',
      celular: fila[2] || '',
      fecha: fila[3] || '',
      notas: fila[4] || '',
      book: fila[5] || '',
      casting: fila[6] || '',
      experiencia: fila[7] || '',
      comoLlego: fila[8] || '',
      origen: fila[9] || '',
      etapa: fila[10] || 'Agendado',
      // fila[11] es el UID interno (columna L), no se expone al panel
      segmento: fila[12] || inferirSegmento(fila[7] || ''),
      notasInternas: fila[13] || '',
    }))
    .filter((lead) => lead.nombre || lead.correo)
    .reverse(); // los más recientes primero

  return json(200, { leads, etapas: ETAPAS_VALIDAS });
}

// ---------------------------------------------------------------------------
// Cambiar la etapa de un lead
// ---------------------------------------------------------------------------

async function actualizarEtapa(body) {
  const rowIndex = Number(body.rowIndex);
  const etapa = body.etapa;

  if (!Number.isInteger(rowIndex) || rowIndex < 2 || !ETAPAS_VALIDAS.includes(etapa)) {
    return json(400, { error: 'Datos inválidos para actualizar la etapa.' });
  }

  const { sheetId, accessToken } = await getSheetAccess();
  const range = `${SHEET_TAB}!K${rowIndex}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    range
  )}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[etapa]] }),
  });

  if (!res.ok) {
    throw new Error(`Sheets API respondió ${res.status}: ${await res.text()}`);
  }

  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// Cambiar el segmento (Bellota/Fénix) de un lead a mano -- corrige o
// reemplaza la inferencia automática. Guardar '' reinicia a "sin clasificar"
// (vuelve a inferirse solo la próxima vez que se liste, en vez de quedar
// forzado a un valor manual).
// ---------------------------------------------------------------------------

async function actualizarSegmento(body) {
  const rowIndex = Number(body.rowIndex);
  const segmento = body.segmento;

  if (!Number.isInteger(rowIndex) || rowIndex < 2 || !SEGMENTOS_VALIDOS.includes(segmento)) {
    return json(400, { error: 'Datos inválidos para actualizar el segmento.' });
  }

  const { sheetId, accessToken } = await getSheetAccess();
  const range = `${SHEET_TAB}!M${rowIndex}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    range
  )}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[segmento]] }),
  });

  if (!res.ok) {
    throw new Error(`Sheets API respondió ${res.status}: ${await res.text()}`);
  }

  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// Guardar la nota de seguimiento interna de Monty (columna N) -- distinta de
// la columna E ("¿Qué le ronda la cabeza?"), que es la respuesta del propio
// actor en el cuestionario de Cal.com y nunca se edita desde aquí.
// ---------------------------------------------------------------------------

async function actualizarNotaInterna(body) {
  const rowIndex = Number(body.rowIndex);
  const notas = typeof body.notas === 'string' ? body.notas.trim().slice(0, 2000) : '';

  if (!Number.isInteger(rowIndex) || rowIndex < 2) {
    return json(400, { error: 'Datos inválidos para guardar la nota.' });
  }

  const { sheetId, accessToken } = await getSheetAccess();
  const range = `${SHEET_TAB}!N${rowIndex}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    range
  )}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[notas]] }),
  });

  if (!res.ok) {
    throw new Error(`Sheets API respondió ${res.status}: ${await res.text()}`);
  }

  return json(200, { ok: true });
}

// ---------------------------------------------------------------------------
// Firma un JWT con la cuenta de servicio y lo cambia por un access token
// OAuth2 (idéntico al que usan submission-created.js y cal-webhook.js).
// ---------------------------------------------------------------------------

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
    throw new Error(`Token de Google respondió ${res.status}: ${await res.text()}`);
  }

  const json2 = await res.json();
  return json2.access_token;
}
