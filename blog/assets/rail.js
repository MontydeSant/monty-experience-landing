/* blog/assets/rail.js — carrusel de artículos del índice: flechas (escritorio), puntos y arrastre con mouse.
   En celular se desliza con el dedo (scroll-snap nativo). */
(function(){
  var rail=document.getElementById('blogRail'); if(!rail) return;
  var prev=document.getElementById('railPrev'), next=document.getElementById('railNext'), dotsBox=document.getElementById('railDots');
  var dots=[];
  function step(){ var c=rail.querySelector('.post-card'); if(!c) return 300; var g=parseFloat(getComputedStyle(rail).columnGap)||18; return c.getBoundingClientRect().width+g; }
  function maxIdx(){ return Math.max(0, Math.ceil((rail.scrollWidth-rail.clientWidth-2)/step())); }
  function goTo(i){ rail.scrollTo({left:Math.min(i*step(), rail.scrollWidth-rail.clientWidth), behavior:'smooth'}); }
  function build(){
    if(!dotsBox) return; dotsBox.innerHTML=''; dots=[];
    var n=maxIdx()+1; if(n<2) return;
    for(var i=0;i<n;i++){ (function(i){ var b=document.createElement('button'); b.type='button'; b.className='rail-dot'; b.setAttribute('aria-label','Ir al grupo '+(i+1)); b.addEventListener('click',function(){ goTo(i); }); dotsBox.appendChild(b); dots.push(b); })(i); }
    dotsBox.removeAttribute('aria-hidden'); update();
  }
  function update(){
    var max=rail.scrollWidth-rail.clientWidth, x=rail.scrollLeft;
    if(prev) prev.disabled = x<=2; if(next) next.disabled = x>=max-2;
    var i=x>=max-2 ? dots.length-1 : Math.round(x/step());
    dots.forEach(function(d,k){ d.classList.toggle('is-active',k===i); });
  }
  if(prev) prev.addEventListener('click',function(){ rail.scrollBy({left:-step(),behavior:'smooth'}); });
  if(next) next.addEventListener('click',function(){ rail.scrollBy({left:step(),behavior:'smooth'}); });
  rail.addEventListener('scroll',function(){ window.requestAnimationFrame(update); },{passive:true});
  window.addEventListener('resize',build);
  rail.addEventListener('dragstart',function(e){ e.preventDefault(); });
  // arrastre con mouse (en táctil manda el scroll nativo)
  var down=false, moved=false, sx=0, sl=0;
  rail.addEventListener('pointerdown',function(e){ if(e.pointerType!=='mouse'||e.button!==0) return; down=true; moved=false; sx=e.clientX; sl=rail.scrollLeft; });
  window.addEventListener('pointermove',function(e){ if(!down) return; var dx=e.clientX-sx; if(!moved&&Math.abs(dx)>5){ moved=true; rail.classList.add('dragging'); } if(moved) rail.scrollLeft=sl-dx; });
  window.addEventListener('pointerup',function(){ if(!down) return; down=false; if(moved){ rail.classList.remove('dragging'); var i=Math.round(rail.scrollLeft/step()); goTo(i); } });
  build();
})();
