/* Rendimiento: pausa las animaciones infinitas de lo que no está en pantalla.
   Visualmente no cambia nada (al volver a verse, la animación continúa donde iba),
   pero el navegador deja de pintar decenas de animaciones a la vez mientras haces scroll. */
(function(){
  if (!('IntersectionObserver' in window) || !document.getAnimations) return;
  var io, seen = new WeakSet();
  function infinite(a){
    try { return a.effect && a.effect.getTiming().iterations === Infinity; } catch(e){ return false; }
  }
  function scan(){
    var list;
    try { list = document.getAnimations(); } catch(e){ return; }
    if (!io){
      io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){ en.target.classList.toggle('perf-off', !en.isIntersecting); });
      }, { rootMargin:'160px 0px 160px 0px', threshold:0 });
    }
    list.forEach(function(a){
      var t = a.effect && a.effect.target;
      if (!t || seen.has(t) || !infinite(a)) return;
      seen.add(t); io.observe(t);
    });
  }
  function start(){ scan(); setTimeout(scan, 2500); }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', function(){
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2000 }); else setTimeout(start, 600);
  });
})();
