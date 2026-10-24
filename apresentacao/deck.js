// Navegação da apresentação: setas, espaço, toque, tela cheia e endereço #n para cada slide.
(function () {
  'use strict';
  var slides = Array.prototype.slice.call(document.querySelectorAll('#deck > section'));
  var count = document.getElementById('count');
  var atual = 0;

  function escala() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    slides.forEach(function (el) { el.style.transform = 'translate(-50%, -50%) scale(' + s + ')'; });
  }
  function ir(n, semHistorico) {
    atual = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (el, i) { el.classList.toggle('atual', i === atual); el.setAttribute('aria-hidden', i === atual ? 'false' : 'true'); });
    count.textContent = (atual + 1) + ' / ' + slides.length;
    if (!semHistorico) history.replaceState(null, '', '#' + (atual + 1));
  }
  function doEndereco() { var n = parseInt(location.hash.slice(1), 10); return isNaN(n) ? 0 : n - 1; }

  document.getElementById('prev').addEventListener('click', function () { ir(atual - 1); });
  document.getElementById('next').addEventListener('click', function () { ir(atual + 1); });
  document.getElementById('full').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); ir(atual + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); ir(atual - 1); }
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(slides.length - 1);
  });
  var x0 = null;
  document.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) ir(atual + (dx < 0 ? 1 : -1));
  });
  document.getElementById('deck').addEventListener('click', function (e) {
    if (e.target.closest('a')) return;
    ir(atual + (e.clientX > window.innerWidth / 3 ? 1 : -1));
  });
  var timer;
  function acordar() { document.body.classList.remove('ocioso'); clearTimeout(timer); timer = setTimeout(function () { document.body.classList.add('ocioso'); }, 2500); }
  ['mousemove', 'touchstart', 'keydown'].forEach(function (t) { document.addEventListener(t, acordar, { passive: true }); });
  window.addEventListener('resize', escala);
  window.addEventListener('hashchange', function () { ir(doEndereco(), true); });
  escala(); ir(doEndereco(), true); acordar();
})();
