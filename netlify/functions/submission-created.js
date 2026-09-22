// netlify/functions/submission-created.js
//
// Se dispara AUTOMÁTICAMENT tras cada envío del formulario "Perfil Monty Experience"
// (Netlify invoca cualquier función con este nombre exacto después de cada submission
// de Netlify Forms — no requiere configurar ningún webhook aparte).
//
// Hace dos cosas, en paralelo:
// 1. Envía un correo de bienvenida con la identidad de Monty Experience al actor,
//    con copia a Monty, vía Resend.
// 2. Agrega una fila con los datos del actor a la hoja "Actores" del Google Sheet
//    "actores_monty_experience", usando una cuenta de servicio de Google.
//
// Variables de entorno requeridas (Netlify → Site configuration → Environment variables):
// - RESEND_API_KEY             → API key de Resend (secreta)
// - GOOGLE_SERVICE_ACCOUNT_KEY → JSON completo de la cuenta de servicio de Google (secreta)
// - GOOGLE_SHEET_ID            → ID del Google Sheet (no es secreta, pero así no queda
//                                 quemada en el código si algún día cambia de hoja)
//
// Si un paso falla (Resend caído, credencial mal pegada, etc.) el otro sigue corriendo:
// no se pierde el correo si falla Sheets, ni viceversa. Los errores quedan en los logs
// de la función en Netlify (Functions → submission-created → ver logs), nunca se le
// muestran al actor, que ya vio su formulario enviado con éxito.

const crypto = require('crypto');

const RESEND_FROM = 'Monty Experience <equipo@montyexperience.com>';
const MONTY_CC = 'lm.productionsfm@gmail.com';
const SHEET_TAB = 'Actores';
const SHEET_RANGE = `${SHEET_TAB}!B:AV`;

exports.handler = async (event) => {
  let data = {};
  try {
    const body = JSON.parse(event.body || '{}');
    data = (body.payload && body.payload.data) || {};
  } catch (err) {
    console.error('No se pudo leer el body del submission:', err);
    return { statusCode: 200, body: 'body inválido, ignorado' };
  }

  // El honeypot de Netlify Forms ya filtra la mayoría de los bots antes de llegar
  // aquí, pero por si acaso: si viene lleno, no procesamos nada.
  if (data['_gotcha']) {
    return { statusCode: 200, body: 'ignorado (honeypot)' };
  }

  const results = await Promise.allSettled([
    sendWelcomeEmail(data),
    appendToSheet(data),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[submission-created] Falló el paso "${i === 0 ? 'email (Resend)' : 'fila (Sheets)'}":`, r.reason);
    }
  });

  // Siempre 200: Netlify no reintenta submissions de formulario, y el actor ya
  // vio la confirmación en la página. Un fallo interno aquí no debe generar
  // ninguna señal de error visible para él.
  return { statusCode: 200, body: 'ok' };
};

// ---------------------------------------------------------------------------
// Email de bienvenida vía Resend
// ---------------------------------------------------------------------------

async function sendWelcomeEmail(data) {
  const nombre = data.nombre_artistico || data.nombre_completo || 'Actor';
  const actorEmail = data.email;

  if (!actorEmail) {
    console.warn('[submission-created] Submission sin campo "email", no se envía correo.');
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [actorEmail],
      cc: [MONTY_CC],
      subject: `${nombre}, ya eres parte del directorio de casting`,
      html: buildEmailHtml(nombre),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend respondió ${res.status}: ${await res.text()}`);
  }
}

// Link real del botón "AGENDAR MI CAFECITO CON MONTY" de la landing (Cal.com,
// data-cal-link="montydesant/30min") — mismo destino que el CTA principal del sitio.
const CAL_LINK = 'https://cal.com/montydesant/30min';

function buildEmailHtml(nombre) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#0d0d0d;padding:40px 20px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:520px;margin:0 auto;background:#161616;border:1px solid #2a2a2a;border-radius:12px;padding:40px 32px;">
      <p style="color:#c9a7ff;letter-spacing:2px;font-size:12px;text-transform:uppercase;margin:0 0 24px;">Monty Experience</p>
      <h1 style="color:#ffffff;font-size:24px;margin:0 0 20px;line-height:1.3;">${escapeHtml(nombre)}, ya eres parte del directorio de casting.</h1>
      <p style="color:#d8d8d8;font-size:15px;line-height:1.7;margin:0 0 16px;">
        Tu perfil quedó registrado. A partir de hoy formas parte del directorio con el que
        trabajamos casting y escuelas de cine.
      </p>
      <p style="color:#d8d8d8;font-size:15px;line-height:1.7;margin:0 0 16px;">
        Pero un perfil no diagnostica nada. Un cafecito sí.
      </p>
      <p style="color:#d8d8d8;font-size:15px;line-height:1.7;margin:0 0 16px;">
        Quiero sentarme contigo — un café online, por Google Meet — para entender exactamente
        dónde estás parado y cómo hacer que tu book te respalde en cada casting.
      </p>
      <p style="color:#d8d8d8;font-size:15px;line-height:1.7;margin:0 0 28px;">
        Si te interesa, dale clic al link de aquí abajo.
      </p>
      <p style="margin:0 0 32px;text-align:center;">
        <a href="${CAL_LINK}" style="display:inline-block;background:#7c5cbf;color:#ffffff;text-decoration:none;font-family:Georgia,'Times New Roman',serif;font-size:15px;padding:14px 28px;border-radius:8px;">Agendar mi cafecito con Monty →</a>
      </p>
      <p style="color:#8a8a8a;font-size:13px;line-height:1.6;margin:0;">
        — Equipo Monty Experience
      </p>
    </div>
  </body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Antes esta columna era una fórmula de Sheets; ahora, como el rango de detección
// ya no incluye la columna A, se calcula aquí mismo y se manda como número — así
// no hay riesgo de pisar ninguna fórmula existente en la hoja.
function computeEdadActual(fechaNacimiento) {
  if (!fechaNacimiento) return '';
  const fecha = new Date(fechaNacimiento);
  if (isNaN(fecha.getTime())) return '';
  const hoy = new Date();
  let edad = hoy.getFullYear() - fecha.getFullYear();
  const mesDiff = hoy.getMonth() - fecha.getMonth();
  if (mesDiff < 0 || (mesDiff === 0 && hoy.getDate() < fecha.getDate())) {
    edad -= 1;
  }
  return edad;
}

// ---------------------------------------------------------------------------
// Fila nueva en Google Sheets
// ---------------------------------------------------------------------------

async function appendToSheet(data) {
  const credsRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!credsRaw || !sheetId) {
    throw new Error('Faltan las variables GOOGLE_SERVICE_ACCOUNT_KEY o GOOGLE_SHEET_ID en Netlify.');
  }

  const creds = JSON.parse(credsRaw);
  const accessToken = await getGoogleAccessToken(creds);

  const contactoActor = [data.contacto_actor, data.email].filter(Boolean).join(' / ');

  // Orden exacto de columnas del Google Sheet "actores_monty_experience", pestaña
  // "Actores" (B → AV, 47 columnas — la columna A "ID" se deja fuera a propósito,
  // ver nota abajo). Las columnas internas (Notas de casting, Fecha de sesión,
  // Paquete, METASTAR, Notas internas) y la que Monty llena después a mano
  // (Link al book) se dejan en blanco.
  const row = [
    data.nombre_completo || '', // B
    data.nombre_artistico || '', // C
    data.fecha_nacimiento || '', // D
    computeEdadActual(data.fecha_nacimiento), // E   Edad actual (calculada aquí mismo)
    data.rango_edad || '', // F
    data.genero_tipo || '', // G
    data.ciudad || '', // H
    data.viaja || '', // I
    data.nacionalidad || '', // J
    data.estatura_cm || '', // K
    data.complexion || '', // L
    data.color_cabello || '', // M
    data.color_ojos || '', // N
    data.tatuajes || '', // O
    data.rasgos_distintivos || '', // P
    data.idiomas || '', // Q
    data.acentos || '', // R
    data.canto || '', // S
    data.baile || '', // T
    data.deportes || '', // U
    data.manejo || '', // V
    data.instrumentos || '', // W
    data.otras_habilidades || '', // X
    data.formacion || '', // Y
    data.coach_taller || '', // Z
    data.anos_experiencia || '', // AA
    data.creditos_cine || '', // AB
    data.creditos_tv || '', // AC
    data.creditos_teatro || '', // AD
    data.comerciales || '', // AE
    data.proyecto_destacado || '', // AF
    '', // AG  Link al book (Monty lo agrega tras la sesión)
    data.reel || '', // AH
    data.instagram || '', // AI
    data.imdb || '', // AJ
    data.sitio_web || '', // AK
    data.tiene_agencia || '', // AL
    data.representante_nombre || '', // AM
    data.representante_contacto || '', // AN
    contactoActor, // AO  tel/email combinados
    data.sindicato || '', // AP
    data.disponibilidad || '', // AQ
    '', // AR  Notas de casting (interno)
    '', // AS  Fecha de sesión (interno)
    '', // AT  Paquete contratado (interno)
    '', // AU  Estatus asesoría METASTAR (interno)
    '', // AV  Notas internas (interno)
  ];

  // Por qué el rango empieza en B y no en A, y por qué OVERWRITE y no INSERT_ROWS:
  // la hoja ya trae, desde antes, la columna A (ID) pre-numerada a mano (1, 2, 3…)
  // en varias filas por adelantado, aunque el resto de esas filas (B en adelante)
  // esté vacío. Si el rango de detección incluye la columna A, la API de Sheets
  // considera esas filas "ocupadas" (por el número de ID) y agrega la fila nueva
  // hasta después de la última, muy abajo y fuera del área con formato — aunque
  // en las columnas correctas. Al anclar la detección solo en B:AV (que sí está
  // realmente vacío en esas filas), la API encuentra la primera fila libre de
  // verdad. Y usando OVERWRITE en vez de INSERT_ROWS, se llena esa fila existente
  // en su lugar (con su ID y formato ya puestos) en vez de insertar una fila nueva
  // que recorriera hacia abajo la numeración y el formato de todo lo que sigue.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    SHEET_RANGE
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  });

  if (!res.ok) {
    throw new Error(`Sheets API respondió ${res.status}: ${await res.text()}`);
  }
}

// Firma un JWT con la cuenta de servicio y lo cambia por un access token OAuth2.
// Se hace a mano con el módulo "crypto" nativo de Node para no depender de la
// librería googleapis completa (menos peso, sin instalar nada extra).
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

  const json = await res.json();
  return json.access_token;
}
