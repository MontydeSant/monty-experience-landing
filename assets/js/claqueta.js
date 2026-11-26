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

  // Línea de tiempo (~0.7 s): el sonido arranca EN el clic; el aplauso cae a los ~.31 s del archivo y
  // el brazo de la claqueta pega en ese mismo instante (global.css). A los .5 s se ejecuta la acción
  // (abre Cal / WhatsApp) y la claqueta se desvanece ENCIMA, sin hacer esperar a nadie.
  var HOLD_MS = 500, FADE_MS = 220;
  // Rutas relativas a ESTE archivo (assets/js/): funcionan en cualquier página,
  // a cualquier profundidad, y también abriendo el HTML con doble clic.
  var BASE = (function () {
    var el = document.currentScript;
    var src = (el && el.src) || '';
    return src ? src.replace(/js\/claqueta\.js(\?.*)?$/, '') : 'assets/';
  })();
  // Archivo normalizado (más fuerte, para bocinas de celular). Nombre nuevo porque el anterior queda en caché 1 año.
  var AUDIO_URL = BASE + 'audio/claqueta-fuerte.wav';
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
      prefetchClap();
      document.removeEventListener('pointerover', onIntent, true);
      document.removeEventListener('touchstart', onIntent, true);
    }
  }

  var overlay, board, playing = false, audioCtx = null, clapBuffer = null, clapPromise = null, clapEl = null, primed = false, clapAsked = false;

  // iOS: que el audio web suene aunque el switch de silencio esté activado (iOS 16.4+).
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}

  function getAudioCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
    return audioCtx;
  }

  // Los bytes del aplauso se descargan en reposo (prefetchClap); la decodificación
  // necesita el AudioContext y se hace en el primer gesto del visitante.
  var clapBytes = null;
  function prefetchClap() {
    if (clapBytes) return clapBytes;
    clapBytes = fetch(AUDIO_URL).then(function (r) { return r.arrayBuffer(); });
    clapBytes.catch(function () { clapBytes = null; });
    return clapBytes;
  }
  function loadClapBuffer(ctx) {
    if (clapBuffer) return Promise.resolve(clapBuffer);
    if (!clapPromise) {
      clapPromise = prefetchClap()
        .then(function (ab) { return ctx.decodeAudioData(ab); })
        .then(function (buf) { clapBuffer = buf; return buf; });
      clapPromise.catch(function () { clapPromise = null; });
    }
    return clapPromise;
  }

  // Elemento <audio> de respaldo: en celular es la vía más fiable (no depende de que el
  // AudioContext haya despertado y, en iOS, suena por el canal de medios).
  function getClapEl() {
    if (!clapEl) {
      try { clapEl = new Audio(AUDIO_URL); clapEl.preload = 'auto'; clapEl.volume = 1; } catch (e) { clapEl = null; }
    }
    return clapEl;
  }

  // "Desbloqueo" de audio: se hace en el PRIMER gesto real del visitante en cualquier parte de
  // la página (tap, clic, tecla). En iOS/Android un sonido solo puede arrancar después de un
  // gesto, y un touchstart sobre el botón no basta (de ahí que en celular no sonara).
  var CTA_SEL = '[data-cal-link], a[href*="wa.me"], a[href*="whatsapp.com"]';
  function primeAudio(e) {
    if (primed) return;
    var onCta = !!(e && e.target && e.target.closest && e.target.closest(CTA_SEL));
    var ctx = getAudioCtx();
    if (ctx) {
      try { ctx.resume(); } catch (e) {}
      loadClapBuffer(ctx).catch(function () {});
      try { // buffer silencioso: abre el canal de audio en iOS
        var b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource();
        src.buffer = b; src.connect(ctx.destination); src.start(0);
      } catch (e) {}
    }
    var el = onCta ? null : getClapEl();   // si el primer gesto ya es el botón, su propio play() desbloquea
    if (el) {
      try {
        el.muted = true;
        var pr = el.play();
        var back = function () { if (clapAsked) return; try { el.pause(); el.currentTime = 0; el.muted = false; } catch (e) {} };
        if (pr && pr.then) pr.then(back, function () { el.muted = false; }); else back();
      } catch (e) {}
    }
    primed = true;
    ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (ev) { document.removeEventListener(ev, primeAudio, true); });
  }

  // Suena el aplauso YA (se llama dentro del clic, que es un gesto válido). El brazo de la claqueta
  // pega a los ~.31 s, justo cuando cae el aplauso del archivo.
  function playClapNow() {
    clapAsked = true;
    var ctx = audioCtx;
    try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) {}
    if (ctx && clapBuffer && ctx.state === 'running') {
      try {
        var src = ctx.createBufferSource();
        src.buffer = clapBuffer;
        var gain = ctx.createGain();
        gain.gain.value = 1;
        src.connect(gain).connect(ctx.destination);
        src.start(0);
        return;
      } catch (e) {}
    }
    var el = getClapEl();
    if (el) {
      try { el.muted = false; el.currentTime = 0; var pr = el.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    }
  }

  function playClaqueta(onDone) {
    if (playing) return;
    playing = true;
    loadLogo();
    overlay.hidden = false;
    void overlay.offsetWidth;
    overlay.classList.add('show');
    board.classList.add('playing');
    playClapNow();
    setTimeout(function () { clapAsked = false; }, 1500);
    setTimeout(function () {
      overlay.classList.remove('show');
      overlay.classList.add('hide');
      onDone();                       // la acción arranca ya; la claqueta se disuelve encima
      setTimeout(function () {
        overlay.hidden = true;
        overlay.classList.remove('hide');
        board.classList.remove('playing');
        playing = false;
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
      // Cal ya se inició y precargó en reposo (warmUp). Aquí solo se garantiza el init
      // por si el clic llegó antes; nada pesado durante la animación.
      if (typeof window.montyCalBoot === 'function') window.montyCalBoot();
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

  // Precalentamiento en reposo (el navegador libre, nunca en el clic):
  // logo, bytes del aplauso y precarga de Cal para el primer botón de agenda.
  function warmUp() {
    loadLogo();
    prefetchClap();
    try {
      if (typeof window.montyCalBoot === 'function') window.montyCalBoot();
      var first = document.querySelector('[data-cal-link]');
      if (first && typeof Cal === 'function') Cal('preload', { calLink: first.getAttribute('data-cal-link'), type: 'modal' });
    } catch (err) {}
  }
  function scheduleWarmUp() {
    var go = function () {
      if ('requestIdleCallback' in window) requestIdleCallback(warmUp, { timeout: 3000 });
      else setTimeout(warmUp, 1500);
    };
    if (document.readyState === 'complete') setTimeout(go, 800);
    else window.addEventListener('load', function () { setTimeout(go, 800); });
  }

  function init() {
    overlay = ensureOverlay();
    scheduleWarmUp();
    board = document.getElementById('claquetaBoard');
    if (!board) return;
    ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (ev) { document.addEventListener(ev, primeAudio, true); });
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerover', onIntent, true);
    document.addEventListener('touchstart', onIntent, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
