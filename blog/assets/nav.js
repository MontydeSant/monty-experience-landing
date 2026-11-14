/* blog/assets/nav.js — menú del header flotante en celular (mismo comportamiento que la landing). */
(function(){
  var nav=document.getElementById('siteNav'), toggle=document.getElementById('siteNavToggle');
  if(!nav||!toggle) return;
  function setOpen(o){ nav.classList.toggle('is-open',o); toggle.setAttribute('aria-expanded',o?'true':'false'); toggle.setAttribute('aria-label',o?'Cerrar menú':'Abrir menú'); }
  toggle.addEventListener('click',function(){ setOpen(!nav.classList.contains('is-open')); });
  nav.querySelectorAll('.site-nav-links a, .site-nav-cta').forEach(function(el){ el.addEventListener('click',function(){ setOpen(false); }); });
  document.addEventListener('click',function(e){ if(nav.classList.contains('is-open')&&!nav.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') setOpen(false); });
})();
