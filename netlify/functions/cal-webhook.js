// netlify/functions/cal-webhook.js
// Recibe el webhook de Cal.com y avisa a Meta:
// (1) evento CAPI (Schedule) con deduplicacion por event_id
// (2) agrega al agendado a la audiencia "Agendaron llamada - Monty Experience"
//
// Regla de oro: ningun secreto vive en este archivo. Todo sale de
// process.env, configurado en Netlify (Site settings -> Environment variables).

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

// El campo responses.location de Cal.com puede venir como string u objeto
// segun el tipo de ubicacion (video, telefono, en persona, etc.). Meta exige
// que event_source_url sea siempre un string.
function resolveEventSourceUrl(booking) {
  const loc = booking.responses?.location?.value;
  if (typeof loc === 'string' && loc.startsWith('http')) return loc;
  return 'https://montyexperience.com';
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
    console.log(`[DIAG] Slug no coincide con TRACKED_SLUGS: "${slug}"`);
    return { statusCode: 200, body: `Ignored (slug not tracked: ${slug})` };
  }

  const attendee = (booking.attendees && booking.attendees[0]) || {};
  const email = attendee.email || null;
  const phone = normalizePhone(attendee.phoneNumber || attendee.phone);
  const bookingUid = booking.uid || `${Date.now()}`;

  const hashedEmail = sha256(email);
  const hashedPhone = sha256(phone);

  const pixelId = process.env.META_PIXEL_ID;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !adAccountId || !accessToken) {
    console.error('Faltan variables de entorno META_PIXEL_ID / META_AD_ACCOUNT_ID / META_ACCESS_TOKEN.');
    return { statusCode: 200, body: 'Missing Meta env vars, logged' };
  }

  console.log(`[DIAG] Enviando evento Schedule a Meta. event_id=${bookingUid}`);

  const capiResult = await sendCapiEvent({
    pixelId,
    accessToken,
    eventName: 'Schedule',
    eventId: bookingUid,
    eventSourceUrl: resolveEventSourceUrl(booking),
    userData: {
      em: hashedEmail ? [hashedEmail] : undefined,
      ph: hashedPhone ? [hashedPhone] : undefined,
    },
    customData: {
      content_name: slug,
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
