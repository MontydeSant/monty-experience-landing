/**
 * tracking.js — Monty Experience
 * Módulo único de medición (Meta Pixel) para todas las páginas del sitio.
 *
 * El Pixel (fbq) y el PageView se cargan en un <script> inline en el <head>
 * de cada página. Este archivo SOLO añade los eventos que importan:
 *
 *   - Lead        → clic en cualquier botón de WhatsApp. Va por Pixel Y por
 *                   servidor (capi-web.js) con el mismo event_id, para que
 *                   Meta lo cuente una sola vez aunque el navegador bloquee el Pixel.
 *   - ViewContent → cuando el visitante abre un paquete (solo navegador).
 *   - Schedule    → cuando Cal.com confirma una reserva (navegador). El servidor
 *                   lo manda por su lado desde cal-webhook.js con el MISMO event_id.
 *   - abrio_agenda→ evento propio al abrir el calendario (solo navegador).
 *
 * Ahorro de créditos de Netlify: SOLO Lead pasa por una función (capi-web).
 * ViewContent, abrio_agenda y Schedule viven en el navegador; la reserva
 * llega a Meta por cal-webhook, que ya existía. Así un pico de tráfico de
 * anuncios no se convierte en un pico de invocaciones.
 *
 * Todo está envuelto en try/catch: el tracking nunca debe romper la página.
 */
window.MX = window.MX || {};

(function (MX) {
  'use strict';

  var HOST_RE = /(^|\.)montyexperience\.com$/;
  var LS_EVENT_ID = 'mx_cal_event_id';
  var LS_SCHEDULE_DONE = 'mx_schedule_done';

  function generateEventId(prefix) {
    return (prefix || 'mx') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function getParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  // ?origen=ads en los links de anuncios; sin parámetro = orgánico.
  function getOrigen() { return getParam('origen') || 'organico'; }

  function getCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function getFbp() { return getCookie('_fbp'); }
  function getFbc() {
    var fbc = getCookie('_fbc');
    if (fbc) return fbc;
    var fbclid = getParam('fbclid');
    return fbclid ? 'fb.1.' + Date.now() + '.' + fbclid : null;
  }

  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  // Relevo al servidor (solo en el dominio real, nunca en pruebas locales).
  // keepalive: sobrevive aunque el clic saque al visitante hacia WhatsApp.
  function sendToServer(eventName, eventId, params) {
    try {
      if (!HOST_RE.test(window.location.hostname)) return;
      fetch('/.netlify/functions/capi-web', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: eventName,
          event_id: eventId,
          event_source_url: window.location.href,
          custom_data: params || undefined,
          fbp: getFbp(),
          fbc: getFbc()
        })
      }).catch(function () {});
    } catch (e) {}
  }

  // Evento estándar de Meta. relay=true → además por servidor.
  function trackEvent(eventName, params, relay, eventId) {
    params = params || {};
    eventId = eventId || generateEventId(eventName.toLowerCase());
    try { if (typeof fbq === 'function') fbq('track', eventName, params, { eventID: eventId }); } catch (e) {}
    if (relay) sendToServer(eventName, eventId, params);
    return eventId;
  }

  // Evento propio (no estándar), solo navegador.
  function trackCustomEvent(eventName, params) {
    var eventId = generateEventId(eventName.toLowerCase());
    try { if (typeof fbq === 'function') fbq('trackCustom', eventName, params || {}, { eventID: eventId }); } catch (e) {}
    return eventId;
  }

  // ───────── Cal.com: event_id + fbp/fbc/origen viajan en metadata ─────────
  // Cal guarda metadata[*] en la reserva y lo reenvía en el webhook como
  // payload.metadata.*; cal-webhook.js lo lee para usar el MISMO event_id.
  // Se escribe en data-cal-config justo antes de que Cal lo lea (clic, fase de captura).
  function prepareCalButton(btn) {
    try {
      var eventId = generateEventId('schedule');
      ssSet(LS_EVENT_ID, eventId);
      var cfg = {};
      try { cfg = JSON.parse(btn.getAttribute('data-cal-config') || '{}'); } catch (e) {}
      cfg['metadata[eventId]'] = eventId;
      cfg['metadata[origen]'] = getOrigen();
      var fbp = getFbp(), fbc = getFbc();
      if (fbp) cfg['metadata[fbp]'] = fbp;
      if (fbc) cfg['metadata[fbc]'] = fbc;
      btn.setAttribute('data-cal-config', JSON.stringify(cfg));
      return eventId;
    } catch (e) { return null; }
  }

  function trackSchedule() {
    if (ssGet(LS_SCHEDULE_DONE)) return;           // una sola vez por sesión
    var eventId = ssGet(LS_EVENT_ID) || generateEventId('schedule');
    ssSet(LS_SCHEDULE_DONE, '1');
    trackEvent('Schedule', { content_name: 'Llamada agendada', origen: getOrigen() }, false, eventId);
  }

  function init() {
    // 1) WhatsApp → Lead (Pixel + servidor)
    // OJO: se escucha en `window` (captura), no en `document`: claqueta.js frena el
    // clic en `document` (captura) con stopImmediatePropagation, y `window` corre antes.
    window.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href*="whatsapp.com"], a[href*="wa.me"]');
      if (!a) return;
      trackEvent('Lead', { content_name: 'WhatsApp', origen: getOrigen(), pagina: window.location.pathname }, true);
    }, true);

    // 2) Botones de Cal → preparar metadata ANTES de que Cal lea la configuración
    window.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-cal-link]');
      if (!btn) return;
      prepareCalButton(btn);
      trackCustomEvent('abrio_agenda', { origen: getOrigen() });
    }, true);

    // 3) Reserva confirmada en el calendario → Schedule (navegador)
    try {
      if (typeof window.Cal === 'function') {
        window.Cal('on', { action: 'bookingSuccessfulV2', callback: trackSchedule });
        window.Cal('on', { action: 'bookingSuccessful', callback: trackSchedule });
      }
    } catch (e) {}

    // 4) Paquetes: ViewContent cuando una tarjeta se abre (solo navegador)
    try {
      var cards = document.querySelectorAll('.pkg-card');
      if (cards.length && 'MutationObserver' in window) {
        var last = '';
        var mo = new MutationObserver(function (muts) {
          muts.forEach(function (m) {
            var c = m.target;
            if (!c.classList || !c.classList.contains('is-open')) return;
            var name = (c.className.match(/pkg-(classic|elite|fenix)/) || [])[1] || 'paquete';
            if (name === last) return;
            last = name;
            trackEvent('ViewContent', { content_name: 'Paquete ' + name, content_category: 'paquetes' }, false);
          });
        });
        cards.forEach(function (c) { mo.observe(c, { attributes: true, attributeFilter: ['class'] }); });
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  MX.trackEvent = trackEvent;
  MX.trackCustomEvent = trackCustomEvent;
  MX.trackSchedule = trackSchedule;
  MX.getOrigen = getOrigen;
})(window.MX);
