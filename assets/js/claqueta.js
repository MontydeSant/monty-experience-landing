/**
 * claqueta.js — Monty Experience (ClapperboardTransition)
 * El gesto de "acción" entre un clic y su resultado. Se dispara SOLO por la
 * decisión explícita del visitante de agendar (botón con data-cal-link) o de
 * escribir por WhatsApp (link a wa.me / whatsapp.com). Nunca por scroll,
 * hover ni carga de página.
 *
 * Es global: cualquier página que lo cargue lo tiene, sin copiar HTML. Si la
 * página no trae el overlay, este archivo lo inserta. Estilos: global.css.
 *
 * Orden de eventos: tracking.js escucha el clic en `window` (captura) y esto
 * en `document` (captura). `window` va primero, así que la medición (Lead,
 * metadata de Cal) corre ANTES de que la claqueta frene el clic.
 */
(function () {
  'use strict';

  var HOLD_MS = 1100, FADE_MS = 220, CLAP_DELAY_S = 0.55, CLAP_SOUND_OFFSET_S = 0.32;
  // Rutas relativas a ESTE archivo (assets/js/): funcionan en cualquier página,
  // a cualquier profundidad, y también abriendo el HTML con doble clic.
  var BASE = (function () {
    var el = document.currentScript;
    var src = (el && el.src) || '';
    return src ? src.replace(/js\/claqueta\.js(\?.*)?$/, '') : 'assets/';
  })();
  var AUDIO_URL = BASE + 'audio/claqueta.wav';
  var LOGO_URL = BASE + 'img/logo-claqueta.webp';

  function ensureOverlay() {
    var overlay = document.getElementById('claquetaOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'claqueta-overlay';
    overlay.id = 'claquetaOverlay';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="claqueta-board" id="claquetaBoard">' +
        '<div class="claqueta-arm"><div class="claqueta-stripes"></div><div class="claqueta-hinge"></div></div>' +
        '<div class="claqueta-body">' +
          '<div class="claqueta-body-stripe"></div><div class="claqueta-flash"></div>' +
          '<div class="claqueta-brand">' +
            '<img class="claqueta-logo" alt="Monty Experience" data-src="' + LOGO_URL + '">' +
            '<span class="claqueta-tag">Fotografía · Personal Branding</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  // El logo de la claqueta (68 KB) NO se descarga al abrir la página: se pide en la
  // primera señal de intención (tocar/pasar el mouse sobre un botón de agenda o WhatsApp)
  // o, como respaldo, justo antes de mostrar la claqueta.
  function loadLogo() {
    var img = document.querySelector('.claqueta-logo[data-src]');
    if (img) { img.src = img.getAttribute('data-src'); img.removeAttribute('data-src'); }
  }
  function onIntent(e) {
    var t = e.target;
    if (t && t.closest && t.closest('[data-cal-link], a[href*="wa.me"], a[href*="whatsapp.com"]')) {
      loadLogo();
      document.removeEventListener('pointerover', onIntent, true);
      document.removeEventListener('touchstart', onIntent, true);
    }
  }

  var overlay, board, playing = false, audioCtx = null, clapBuffer = null, clapPromise = null;

  function getAudioCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
    return audioCtx;
  }

  function loadClapBuffer(ctx) {
    if (clapBuffer) return Promise.resolve(clapBuffer);
    if (!clapPromise) {
      clapPromise = fetch(AUDIO_URL)
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return ctx.decodeAudioData(ab); })
        .then(function (buf) { clapBuffer = buf; return buf; });
    }
    return clapPromise;
  }

  function scheduleClapSound(delaySeconds) {
    var ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var startAt = ctx.currentTime + Math.max(0, delaySeconds - CLAP_SOUND_OFFSET_S);
    loadClapBuffer(ctx).then(function (buffer) {
      try {
        var src = ctx.createBufferSource();
        src.buffer = buffer;
        var gain = ctx.createGain();
        gain.gain.value = 0.9;
        src.connect(gain).connect(ctx.destination);
        src.start(startAt);
      } catch (e) {}
    }).catch(function () {});
  }

  function playClaqueta(onDone) {
    if (playing) return;
    playing = true;
    loadLogo();
    overlay.hidden = false;
    void overlay.offsetWidth;
    overlay.classList.add('show');
    board.classList.add('playing');
    scheduleClapSound(CLAP_DELAY_S);
    setTimeout(function () {
      overlay.classList.remove('show');
      overlay.classList.add('hide');
      setTimeout(function () {
        overlay.hidden = true;
        overlay.classList.remove('hide');
        board.classList.remove('playing');
        playing = false;
        onDone();
      }, FADE_MS);
    }, HOLD_MS);
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var calBtn = t.closest('[data-cal-link]');
    if (calBtn) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var calLink = calBtn.getAttribute('data-cal-link');
      var calConfig = {};
      try { calConfig = JSON.parse(calBtn.getAttribute('data-cal-config') || '{}'); } catch (err) {}
      if (typeof Cal === 'function') {
        try { Cal('preload', { calLink: calLink, type: 'modal' }); } catch (err) {}
      }
      playClaqueta(function () {
        if (typeof Cal === 'function') Cal('modal', { calLink: calLink, config: calConfig });
        else window.open('https://cal.com/' + calLink, '_blank', 'noopener');
      });
      return;
    }

    var waBtn = t.closest('a[href*="wa.me"], a[href*="whatsapp.com"]');
    if (waBtn) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var href = waBtn.href;
      var targetBlank = waBtn.target === '_blank';
      playClaqueta(function () {
        if (targetBlank) window.open(href, '_blank', 'noopener');
        else window.location.href = href;
      });
    }
  }

  function init() {
    overlay = ensureOverlay();
    board = document.getElementById('claquetaBoard');
    if (!board) return;
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerover', onIntent, true);
    document.addEventListener('touchstart', onIntent, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
