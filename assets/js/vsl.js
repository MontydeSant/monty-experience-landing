/* vsl.js — comportamiento de la sección VSL (inclinación 3D, destello, play de YouTube, entrada suave) */
(function(){
  var root = document.getElementById('vsl');
  if(!root) return;
  var tilt = document.getElementById('vslTilt');
  var frame = document.getElementById('vslFrame');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wide = function(){ return window.innerWidth > 560; };  // 3D con mouse en cualquier ventana de escritorio, aunque sea angosta

  /* ---- entrada suave ---- */
  root.classList.add('vsl-armed');
  var items = root.querySelectorAll('.vsl-rv');
  if(reduce || !('IntersectionObserver' in window)){
    items.forEach(function(el){ el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
    }, {threshold:.12, rootMargin:'0px 0px -6% 0px'});
    items.forEach(function(el, i){ el.style.setProperty('--i', i); io.observe(el); });
  }

  /* ---- inclinación 3D con suavizado + destello que sigue al cursor ---- */
  if(!reduce){
    var max = 7, cx = 0, cy = 0, tx = 0, ty = 0, raf = 0;
    var loop = function(){
      cx += (tx - cx) * .12; cy += (ty - cy) * .12;
      tilt.style.setProperty('--rx', (-cy * max).toFixed(2) + 'deg');
      tilt.style.setProperty('--ry', (cx * max).toFixed(2) + 'deg');
      raf = (Math.abs(tx - cx) > .002 || Math.abs(ty - cy) > .002) ? requestAnimationFrame(loop) : 0;
    };
    var kick = function(){ if(!raf) raf = requestAnimationFrame(loop); };
    tilt.addEventListener('pointermove', function(e){
      if(e.pointerType === 'touch' || !wide() || tilt.classList.contains('playing')) return;
      var r = tilt.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - .5) * 2;
      ty = ((e.clientY - r.top) / r.height - .5) * 2;
      var v = frame.getBoundingClientRect();
      frame.style.setProperty('--mx', (e.clientX - v.left) + 'px');
      frame.style.setProperty('--my', (e.clientY - v.top) + 'px');
      kick();
    });
    tilt.addEventListener('pointerleave', function(){ tx = 0; ty = 0; kick(); });
  }

  /* ---- un solo clic: carga YouTube con sonido ---- */
  frame.addEventListener('click', function(){
    var id = (frame.getAttribute('data-yt') || '').trim();
    frame.textContent = '';
    if(!id || id === 'TU_ID_DE_YOUTUBE'){
      var soon = document.createElement('div');
      soon.className = 'vsl-soon';
      soon.textContent = 'Aquí va tu video de YouTube (falta poner el ID en data-yt).';
      frame.appendChild(soon);
      frame.classList.add('is-playing');
      return;
    }
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0&playsinline=1';
    f.title = 'Video de Monty Experience';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    f.allowFullscreen = true;
    frame.appendChild(f);
    frame.classList.add('is-playing');
    tilt.classList.add('playing');
    tilt.style.setProperty('--rx', '0deg'); tilt.style.setProperty('--ry', '0deg');
  }, {once:true});
})();

/* ---- Tarjetas de paquetes: inclinación 3D + halo del color de cada paquete (solo escritorio con mouse) ---- */
(function(){
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  if(reduce || !fine) return;
  var cards = document.querySelectorAll('.pkg-card');
  var modal = document.getElementById('expModal');
  var wide = function(){ return window.innerWidth > 900; };

  cards.forEach(function(el){
    var max = 8, cx = 0, cy = 0, tx = 0, ty = 0, raf = 0, frozen = false;
    var paint = function(){
      el.style.setProperty('--rx', (-cy * max).toFixed(2) + 'deg');
      el.style.setProperty('--ry', (cx * max).toFixed(2) + 'deg');
    };
    var loop = function(){
      cx += (tx - cx) * .12; cy += (ty - cy) * .12;
      paint();
      raf = (Math.abs(tx - cx) > .002 || Math.abs(ty - cy) > .002) ? requestAnimationFrame(loop) : 0;
    };
    var kick = function(){ if(!raf) raf = requestAnimationFrame(loop); };
    var flat = function(){            // deja la tarjeta recta, sin animar (para que el pop-up salga de ella sin desfase)
      tx = ty = cx = cy = 0; if(raf){ cancelAnimationFrame(raf); raf = 0; } paint();
    };
    el.addEventListener('pointermove', function(e){
      if(e.pointerType === 'touch' || !wide() || frozen) return;
      if(modal && modal.classList.contains('is-open')) return;
      var r = el.getBoundingClientRect();
      // r ya incluye la inclinación; se usa el centro y el tamaño layout para no oscilar
      tx = ((e.clientX - r.left) / r.width - .5) * 2;
      ty = ((e.clientY - r.top) / r.height - .5) * 2;
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      kick();
    });
    el.addEventListener('pointerleave', function(){ tx = 0; ty = 0; kick(); });
    el.addEventListener('pointerdown', function(){ frozen = true; flat(); }, true);
    el.addEventListener('click', function(){ setTimeout(function(){ frozen = false; }, 600); }, true);
  });
})();
