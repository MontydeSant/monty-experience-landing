/* blog/assets/blog.js — medición compartida del blog (índice y posts).
   · ViewContent al cargar cada post (alimenta la audiencia "Leyó el blog" de Meta Ads).
   · cta_desde_blog al tocar el botón final que lleva de vuelta a la landing.
   Usa el MISMO Pixel (mismo ID) que la landing. Si el Pixel no cargó, no pasa nada. */
(function () {
  'use strict';
  function track(kind, name, params) { try { if (typeof fbq === 'function') fbq(kind, name, params); } catch (e) {} }
  var title = document.body.getAttribute('data-post-title');
  if (title) track('track', 'ViewContent', { content_name: title, content_type: 'article' });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.post-cta a');
    if (a) track('trackCustom', 'cta_desde_blog', { content_name: title || 'blog', destino: 'landing' });
  });
})();
