/* CXR reading-session player. Each case: a NIH radiologist-confirmed finding + real
 * ground-truth box, the live model's real (uncalibrated) score + Grad-CAM attention,
 * and a 3-section pt-BR draft. Descriptive, non-diagnostic; physician signs. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CASE_MS = 8500;
  var $ = function (id) { return document.getElementById(id); };
  var xray = $('xray'), cam = $('cam'), box = $('box'), stage = $('stage'),
      counter = $('counter'), studyid = $('studyid'), findings = $('findings'),
      rtec = $('rtec'), rach = $('rach'), rimp = $('rimp'), hudmod = $('hudmod'),
      signbtn = $('signbtn'), signed = $('signed'), thumbs = $('thumbs'),
      rv1 = document.querySelector('.rv1'), playBtn = $('play'), prevBtn = $('prev'), nextBtn = $('next');
  var cases = [], N = 0, cur = 0, playing = true, timers = [];

  function pad(n) { return String(n).padStart(2, '0'); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function renderPanel(c) {
    var html = '<div class="conf">'
      + '<div class="conf-top"><span class="conf-name">' + esc(c.gt.pt) + '</span>'
      + '<span class="chip mono">confirmado · NIH</span></div>'
      + '<div class="conf-row"><span>concordância do modelo · proxy-txv-v1</span>'
      + '<span class="fv">' + c.model_score.toFixed(2) + '</span></div>'
      + '<div class="track"><div class="fill gt"></div></div></div>';
    if (c.secondary && c.secondary.length) {
      html += '<div class="seclab mono">O modelo também sinaliza (indeterminado)</div>';
      c.secondary.forEach(function (f) {
        html += '<div class="f low"><span class="fn">' + esc(f.pt) + '</span>'
          + '<span class="fv">' + f.score.toFixed(2) + '</span>'
          + '<div class="track"><div class="fill"></div></div></div>';
      });
    }
    findings.innerHTML = html;
  }
  function animateFills(c) {
    var gt = findings.querySelector('.fill.gt');
    if (gt) gt.style.width = Math.round(c.model_score * 100) + '%';
    var fs = findings.querySelectorAll('.f .fill');
    (c.secondary || []).forEach(function (f, i) { if (fs[i]) fs[i].style.width = Math.round(f.score * 100) + '%'; });
  }

  function placeBox(b) {
    if (!b) { box.hidden = true; box.classList.remove('on'); return; }
    box.hidden = false;
    box.style.left = (b[0] * 100).toFixed(1) + '%';
    box.style.top = (b[1] * 100).toFixed(1) + '%';
    box.style.width = (b[2] * 100).toFixed(1) + '%';
    box.style.height = (b[3] * 100).toFixed(1) + '%';
    box.classList.add('on');
  }

  function typeInto(el, txt, done) {
    if (reduce) { el.textContent = txt; if (done) done(); return; }
    var n = 0, step = Math.max(9, Math.min(22, 1400 / txt.length));
    (function tick() {
      n++;
      el.innerHTML = esc(txt.slice(0, n)) + '<span class="caret">.</span>';
      if (n < txt.length) timers.push(setTimeout(tick, step));
      else { el.innerHTML = esc(txt); if (done) done(); }
    })();
  }
  function typeReport(rep) {
    rtec.textContent = rep.tecnica;
    typeInto(rach, rep.achados, function () { typeInto(rimp, rep.impressao); });
  }

  function doSign() {
    if (signbtn.disabled) return;
    signbtn.disabled = true; signed.hidden = false; rv1.textContent = 'Assinado (demonstração)';
  }

  function updateThumbs() {
    [].forEach.call(thumbs.children, function (t, i) { t.classList.toggle('on', i === cur); });
    var a = thumbs.children[cur];
    if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function show(i) {
    clearTimers();
    cur = ((i % N) + N) % N;
    var c = cases[cur];
    counter.textContent = pad(cur + 1) + ' / ' + N;
    studyid.textContent = c.id;
    hudmod.textContent = 'DX · CHEST ' + (c.view || 'PA');
    updateThumbs();
    cam.classList.remove('on'); box.hidden = true; box.classList.remove('on');
    signed.hidden = true; signbtn.disabled = false; rv1.textContent = 'Aguardando assinatura';
    rtec.textContent = ''; rach.innerHTML = ''; rimp.innerHTML = '';
    xray.src = 'data/img/' + pad(cur) + '.jpg';
    cam.src = 'data/cam/' + pad(cur) + '.png';
    renderPanel(c);
    stage.classList.remove('reading'); void stage.offsetWidth; stage.classList.add('reading');
    timers.push(setTimeout(function () { animateFills(c); }, 260));
    timers.push(setTimeout(function () { cam.classList.add('on'); placeBox(c.gt.box); }, 950));
    timers.push(setTimeout(function () { typeReport(c.report); }, 1500));
    timers.push(setTimeout(function () { if (playing) doSign(); }, CASE_MS - 1500));
    if (playing) timers.push(setTimeout(function () { show(cur + 1); }, CASE_MS));
  }

  function buildThumbs() {
    cases.forEach(function (c, i) {
      var t = document.createElement('button');
      t.className = 't'; t.title = c.gt.pt + ' · modelo ' + c.model_score.toFixed(2);
      var im = document.createElement('img'); im.src = 'data/img/' + pad(i) + '.jpg'; im.alt = '';
      t.appendChild(im);
      t.addEventListener('click', function () { show(i); });
      thumbs.appendChild(t);
    });
  }

  playBtn.addEventListener('click', function () {
    playing = !playing; playBtn.textContent = playing ? '❚❚' : '▶';
    if (playing) show(cur); else clearTimers();
  });
  prevBtn.addEventListener('click', function () { show(cur - 1); });
  nextBtn.addEventListener('click', function () { show(cur + 1); });
  signbtn.addEventListener('click', doSign);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') show(cur + 1);
    else if (e.key === 'ArrowLeft') show(cur - 1);
    else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  });

  fetch('data/session.json').then(function (r) { return r.json(); }).then(function (meta) {
    cases = meta.cases || []; N = cases.length;
    if (!N) { rach.textContent = 'Sem dados de sessão.'; return; }
    buildThumbs();
    show(0);
  }).catch(function () { rach.textContent = 'Falha ao carregar data/session.json (sirva via http).'; });
})();
