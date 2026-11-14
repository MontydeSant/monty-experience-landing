/* blog/assets/ui.js — transición entre páginas del blog y barra de progreso de lectura.
   · Al abrir un artículo (o volver), el contenido se disuelve ~300 ms y la tarjeta elegida "salta" un poco; el header no se mueve.
   · Sin JS o con prefers-reduced-motion, los enlaces funcionan normal y al instante. */
(function(){
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function reset(){ document.body.classList.remove('is-leaving'); var c=document.querySelector('.post-card.is-chosen'); if(c) c.classList.remove('is-chosen'); }
  window.addEventListener('pageshow',function(e){ if(e.persisted) reset(); });
  document.addEventListener('click',function(e){
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey) return;
    var a=e.target.closest&&e.target.closest('a[href]'); if(!a||a.target||a.hasAttribute('download')) return;
    var u; try{ u=new URL(a.href,location.href); }catch(x){ return; }
    if(u.origin!==location.origin||u.pathname===location.pathname) return;
    e.preventDefault();
    var card=a.closest('.post-card'); if(card) card.classList.add('is-chosen');
    document.body.classList.add('is-leaving');
    setTimeout(function(){ location.href=a.href; }, reduce?0:300);
  });
  var post=document.querySelector('.post'); if(!post||reduce) return;
  var bar=document.createElement('div'); bar.className='read-progress'; bar.setAttribute('aria-hidden','true'); document.body.appendChild(bar);
  var tick=false;
  function upd(){ tick=false; var r=post.getBoundingClientRect(), total=r.height-window.innerHeight*0.6, done=Math.min(Math.max(-r.top,0),Math.max(total,1)); bar.style.transform='scaleX('+(done/Math.max(total,1))+')'; }
  window.addEventListener('scroll',function(){ if(!tick){ tick=true; requestAnimationFrame(upd); } },{passive:true});
  window.addEventListener('resize',upd); upd();
})();
