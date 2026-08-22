// netlify/functions/capi.js
// Helper: Conversions API (Meta) + Custom Audiences (Marketing API).
// No secretos hardcodeados: todo viene de variables de entorno de Netlify.

const crypto = require('crypto');

const GRAPH_VERSION = 'v21.0';

function sha256(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Normaliza telefono a solo digitos, con codigo de pais, sin '+' ni espacios.
function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/[^\d]/g, '');
}

function verifyCalSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signatureHeader, 'hex')
    );
  } catch (_e) {
    return false;
  }
}

// Envia un evento server-side a Meta via Conversions API.
async function sendCapiEvent({ pixelId, accessToken, eventName, eventId, eventSourceUrl, userData, customData }) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'system_generated',
        event_source_url: eventSourceUrl,
        user_data: userData,
        custom_data: customData || {},
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('CAPI error:', JSON.stringify(json));
  }
  return { ok: res.ok, body: json };
}

// Busca una audiencia personalizada por nombre; si no existe, la crea.
// Devuelve el audience_id.
async function findOrCreateAudience({ adAccountId, accessToken, name }) {
  const searchUrl = `https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/customaudiences?fields=id,name&limit=200&access_token=${encodeURIComponent(accessToken)}`;
  const searchRes = await fetch(searchUrl);
  const searchJson = await searchRes.json().catch(() => ({}));

  if (searchRes.ok && Array.isArray(searchJson.data)) {
    const existing = searchJson.data.find((a) => a.name === name);
    if (existing) return existing.id;
  } else {
    console.error('Audience search error:', JSON.stringify(searchJson));
  }

  const createUrl = `https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/customaudiences?access_token=${encodeURIComponent(accessToken)}`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      subtype: 'CUSTOM',
      description: 'Creada automaticamente por el webhook de Cal.com',
      customer_file_source: 'USER_PROVIDED_ONLY',
    }),
  });
  const createJson = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    console.error('Audience create error:', JSON.stringify(createJson));
    return null;
  }
  return createJson.id;
}

// Agrega un usuario (ya hasheado) a una audiencia personalizada.
async function addUserToAudience({ audienceId, accessToken, hashedEmail, hashedPhone }) {
  if (!audienceId) return { ok: false };

  const schema = [];
  const dataRow = [];
  if (hashedEmail) {
    schema.push('EMAIL');
    dataRow.push(hashedEmail);
  }
  if (hashedPhone) {
    schema.push('PHONE');
    dataRow.push(hashedPhone);
  }
  if (schema.length === 0) return { ok: false };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${audienceId}/users?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: {
        schema,
        data: [dataRow],
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Audience add-user error:', JSON.stringify(json));
  }
  return { ok: res.ok, body: json };
}

module.exports = {
  sha256,
  normalizePhone,
  verifyCalSignature,
  sendCapiEvent,
  findOrCreateAudience,
  addUserToAudience,
};
