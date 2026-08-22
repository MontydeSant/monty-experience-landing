// netlify/functions/cal-webhook.js
// Recibe el webhook "Booking created" de Cal.com y avisa a Meta:
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

const AUDIENCE_NAME = 'Agendaron llamada - Monty Experience';

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

  // Solo nos interesa la creacion de reservas.
  if (payload.triggerEvent !== 'BOOKING_CREATED') {
    return { statusCode: 200, body: 'Ignored (not BOOKING_CREATED)' };
  }

  const booking = payload.payload || {};
  const slug = booking.eventType?.slug || booking.type || '';

  if (!TRACKED_SLUGS.includes(slug)) {
    // Bug conocido de la skill: sin este filtro cualquier otro evento de
    // Cal.com contamina la audiencia. Se ignora silenciosamente.
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
    // Respondemos 200 para que Cal.com no reintente infinito por un error
    // de configuracion nuestro; el log queda para diagnosticar.
    return { statusCode: 200, body: 'Missing Meta env vars, logged' };
  }

  // 1) Evento CAPI con deduplicacion (event_id = uid de la reserva)
  await sendCapiEvent({
    pixelId,
    accessToken,
    eventName: 'Schedule',
    eventId: bookingUid,
    eventSourceUrl: booking.responses?.location?.value || 'https://montyexperience.com',
    userData: {
      em: hashedEmail ? [hashedEmail] : undefined,
      ph: hashedPhone ? [hashedPhone] : undefined,
    },
    customData: {
      content_name: slug,
    },
  });

  // 2) Find-or-create de la audiencia + agregar al agendado
  const audienceId = await findOrCreateAudience({
    adAccountId,
    accessToken,
    name: AUDIENCE_NAME,
  });

  if (audienceId) {
    await addUserToAudience({
      audienceId,
      accessToken,
      hashedEmail,
      hashedPhone,
    });
  }

  return { statusCode: 200, body: 'OK' };
};
