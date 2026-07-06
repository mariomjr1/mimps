/* Reading-session player, parametrized by MODALITY (chest | limb | brain). Each case:
 * a finding/prediction + box, the live model's real (uncalibrated) score + Grad-CAM
 * attention, and a 3-section pt-BR draft. Descriptive, non-diagnostic; physician signs.
 * (brain = braintumor-classifier-v1, 4-class RM; ~99% is a CURATED-benchmark ceiling,
 * not clinical, R&D-only data.) Entry = #chooser (three cards); each modality loads
 * data/<modality>/session.json (+ img/NN.jpg, cam/NN.png) with the SAME schema.
 * Deep-link: ?m=chest|limb|brain. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CASE_MS = 8500;
  var $ = function (id) { return document.getElementById(id); };
  var xray = $('xray'), cam = $('cam'), box = $('box'), stage = $('stage'),
      counter = $('counter'), studyid = $('studyid'), findings = $('findings'),
      rtec = $('rtec'), rach = $('rach'), rimp = $('rimp'), hudmod = $('hudmod'),
      signbtn = $('signbtn'), signed = $('signed'), thumbs = $('thumbs'), pdfbtn = $('pdfbtn'),
      rv1 = document.querySelector('.rv1'), rv2 = document.querySelector('.rv2'),
      playBtn = $('play'), prevBtn = $('prev'), nextBtn = $('next'),
      pdfmodal = $('pdfmodal'), pdfframe = $('pdfframe'), pdfdownload = $('pdfdownload'),
      pdfclose = $('pdfclose'), pdfopen = $('pdfopen'),
      chooser = $('chooser'), swapBtn = $('swap'), viewerEl = document.querySelector('main.viewer'),
      controlsEl = document.querySelector('footer.controls'), demotag = $('demotag'),
      bmodel = $('bmodel'), hudsrc = $('hudsrc'), ptag = $('ptag'), pmeta = $('pmeta');
  var cases = [], N = 0, cur = 0, playing = true, timers = [], META = {}, pdfUrl = null;
  var DV = '?d=20260707a';  // data cache-buster: data/* are plain-named, so bump this when the data changes (Cloudflare)

  // ---- modality registry: everything chest-vs-limb lives here (same session schema) ----
  var MODS = {
    chest: {
      model: 'proxy-txv-v1', hud: 'DX · CHEST', src: 'NIH ChestX-ray14', examTitle: 'LAUDO DE TÓRAX',
      chip: 'confirmado · NIH', ptag: 'referência NIH + modelo',
      pmeta: 'achado: NIH · caixa + calor: atenção do modelo (Grad-CAM) · pontuação não calibrada',
      demo: 'Demo · saída real do modelo · achados descritivos, não diagnósticos · dados NIH ChestX-ray14 (pesquisa)',
      alt: 'Radiografia de tórax'
    },
    limb: {
      model: 'limbfrac-fracatlas-v1', hud: 'DX · LIMB', src: 'FracAtlas', examTitle: 'LAUDO DE MEMBRO',
      chip: 'modelo · FracAtlas', ptag: 'referência FracAtlas + modelo',
      pmeta: 'achado: FracAtlas · caixa + calor: atenção do modelo (Grad-CAM) · pontuação não calibrada',
      demo: 'Demo · saída real do modelo · achados descritivos, não diagnósticos · dados FracAtlas (pesquisa)',
      alt: 'Radiografia de membro'
    },
    brain: {
      model: 'braintumor-classifier-v1', hud: 'RM · BRAIN', src: 'agregado (P&D)', examTitle: 'LAUDO DE RM DE CRÂNIO',
      chip: 'modelo · 4 classes', ptag: 'predição do modelo (4 classes)',
      pmeta: 'predição do modelo · caixa + calor: atenção Grad-CAM (grosseira, não localiza) · escore não calibrado · ~99% = teto de benchmark curado, não clínico',
      demo: 'Demo · saída real do modelo · classificação descritiva, não diagnóstica · dados agregados de licença incerta → apenas P&D, não é produto',
      alt: 'RM de crânio'
    }
  };
  var modality = null, MOD = null, DATA_ROOT = '';
  var bootSeq = 0;  // invalidates in-flight session fetches on switch/re-entry (no stacked thumbs/timers)
  var DOCTOR = { nome: 'Dra. Helena Marques', crm: '123456', uf: 'SP' };  // demo persona (report watermarked)
  var lastSignedHuman = '';
  var LN = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Almeida', 'Nascimento',
    'Araújo', 'Ferreira', 'Rocha', 'Carvalho', 'Gomes', 'Ribeiro', 'Martins', 'Barbosa', 'Teixeira'];
  var FN_M = ['José', 'Antônio', 'João', 'Carlos', 'Paulo', 'Pedro', 'Rafael', 'Marcos', 'Bruno', 'Ricardo'];
  var FN_F = ['Maria', 'Ana', 'Francisca', 'Sandra', 'Marta', 'Luiza', 'Beatriz', 'Helena', 'Cláudia', 'Fernanda'];
  var INST = ['Hospital São Lucas', 'Santa Casa de Misericórdia', 'Hospital das Clínicas', 'Instituto do Tórax', 'Hospital Santa Helena'];
  var REQ = ['Dr. A. Ferreira', 'Dra. C. Ramos', 'Dr. L. Tavares', 'Dra. P. Nogueira', 'Dr. R. Batista'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // ---- PDF: deterministic (clearly-demo) demographics + image compositing ----
  function h32(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function fmtNow() { var d = new Date(); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function demographics(c) {
    var h = h32(c.id + c.src), sexo = (h & 1) ? 'M' : 'F';
    var fn = (sexo === 'M' ? FN_M : FN_F);
    var nome = fn[h % fn.length] + ' ' + LN[(h >> 3) % LN.length] + ' ' + LN[(h >> 8) % LN.length];
    var idade = 32 + (h % 55), year = 2026 - idade;
    return {
      nome: nome, prontuario: String(100000 + (h % 900000)), idade: idade + ' anos', sexo: sexo,
      nascimento: pad(1 + ((h >> 9) % 28)) + '/' + pad(1 + ((h >> 5) % 12)) + '/' + year,
      acesso: 'CR2026' + String(1000 + ((h >> 4) % 9000)),
      dataExame: pad(1 + ((h >> 7) % 28)) + '/' + pad(1 + ((h >> 11) % 7)) + '/2026 ' + pad(8 + ((h >> 2) % 9)) + ':' + pad((h >> 6) % 60),
      solicitante: REQ[(h >> 12) % REQ.length], instituicao: INST[(h >> 13) % INST.length],
    };
  }
  function composeImage(c) {
    try {
      var S = 620, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
      var g = cv.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
      if (xray.complete && xray.naturalWidth) g.drawImage(xray, 0, 0, S, S);
      if (cam.complete && cam.naturalWidth) { g.globalAlpha = 0.55; g.drawImage(cam, 0, 0, S, S); g.globalAlpha = 1; }
      var b = c.gt && c.gt.box;
      if (b) {
        g.strokeStyle = '#8b8bff'; g.lineWidth = 3; g.strokeRect(b[0] * S, b[1] * S, b[2] * S, b[3] * S);
        g.font = 'bold 15px Inter, sans-serif'; var lbl = 'IA · realce', tw = g.measureText(lbl).width;
        g.fillStyle = '#8b8bff'; g.fillRect(b[0] * S - 1, b[1] * S - 20, tw + 10, 18);
        g.fillStyle = '#0a0a14'; g.fillText(lbl, b[0] * S + 4, b[1] * S - 6);
      }
      return cv.toDataURL('image/png');
    } catch (e) { return null; }
  }
  function generatePdf(c) {
    if (!c || !(window.BVPdf && window.jspdf)) { alert('Gerador de PDF indisponível.'); return; }
    var doc = window.BVPdf.generate(c, {
      patient: demographics(c), doctor: DOCTOR,
      model: { name: META.model || (MOD && MOD.model) || 'modelo', benchmark: META.benchmark || '' },
      imageDataUrl: composeImage(c),
      examTitle: (MOD && MOD.examTitle) || 'LAUDO DE TÓRAX',
      signatureHash: (h32(c.id + DOCTOR.crm).toString(16) + h32(c.src).toString(16)).slice(0, 12),
      signedAtHuman: lastSignedHuman || fmtNow(),
    });
    if (doc) openPreview(doc, 'laudo-' + c.id + '.pdf');
  }
  // show the PDF in an in-page viewer BEFORE downloading; download is a button inside it
  function openPreview(doc, filename) {
    playing = false; playBtn.textContent = '▶'; clearTimers();   // freeze auto-play behind the modal
    stopTyping(true);   // settle the report to full text so the preview/PDF is never half-typed
    try {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfUrl = URL.createObjectURL(doc.output('blob'));
      pdfframe.src = pdfUrl;
      pdfopen.href = pdfUrl;
      pdfdownload.onclick = function () { try { doc.save(filename); } catch (e) { window.open(pdfUrl, '_blank'); } };
      pdfmodal.hidden = false;
    } catch (e) {
      try { doc.save(filename); } catch (e2) { alert('Não foi possível gerar o PDF.'); }
    }
  }
  function closePreview() {
    pdfmodal.hidden = true; pdfframe.removeAttribute('src');
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = null; }
  }

  // Non-specific catch-all labels are excluded from the "também sinaliza" list —
  // guard both the pt label and the raw NIH/torchxrayvision name.
  var SEC_EXCLUDE = {
    'Opacidade': 1, 'Mediastino': 1, 'Infiltrado': 1,
    'Lung Opacity': 1, 'Enlarged Cardiomediastinum': 1, 'Infiltration': 1
  };
  var shownSec = [];  // the secondary finding(s) actually rendered — kept in sync for animateFills
  function pickSecondary(c) {
    return (c.secondary || [])
      .filter(function (f) { return !SEC_EXCLUDE[f.pt] && !SEC_EXCLUDE[f.name] && f.score >= 0.5; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 1);  // at most the single highest-scoring specific secondary finding
  }
  function renderPanel(c) {
    var html = '<div class="conf">'
      + '<div class="conf-top"><span class="conf-name">' + esc(c.gt.pt) + '</span>'
      + '<span class="chip mono">' + esc(MOD ? MOD.chip : '') + '</span></div>'
      + '<div class="conf-row"><span>concordância do modelo · ' + esc(META.model || (MOD && MOD.model) || '') + '</span>'
      + '<span class="fv">' + c.model_score.toFixed(2) + '</span></div>'
      + '<div class="track"><div class="fill gt"></div></div></div>';
    shownSec = pickSecondary(c);
    if (shownSec.length) {
      html += '<div class="seclab mono">O modelo também sinaliza (indeterminado)</div>';
      shownSec.forEach(function (f) {
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
    shownSec.forEach(function (f, i) { if (fs[i]) fs[i].style.width = Math.round(f.score * 100) + '%'; });
  }

  // The box is drawn as %-of-stage, but #xray/#cam use object-fit:cover. The source
  // images are square (1024²-normalized coords, delivered as 528²), so on a square
  // stage cover is a no-op and %-of-stage == image coords. To stay bulletproof at any
  // viewport (a stage that ever renders non-square would make cover crop and the box
  // drift), map the box through the image's ACTUAL rendered content rect: for cover of
  // a square source, the painted image is a centered square of side = max(W,H), and the
  // #cam overlay shares the identical fit+element rect so it stays pixel-aligned too.
  var curBox = null;
  function placeBox(b) {
    curBox = b || null;
    if (!b) { box.hidden = true; box.classList.remove('on'); return; }
    var r = stage.getBoundingClientRect(), W = r.width || 1, H = r.height || 1;
    var side = Math.max(W, H), offX = (W - side) / 2, offY = (H - side) / 2;
    box.hidden = false;
    box.style.left = ((offX + b[0] * side) / W * 100).toFixed(2) + '%';
    box.style.top = ((offY + b[1] * side) / H * 100).toFixed(2) + '%';
    box.style.width = (b[2] * side / W * 100).toFixed(2) + '%';
    box.style.height = (b[3] * side / H * 100).toFixed(2) + '%';
    box.classList.add('on');
  }

  // The report typewriter is SELF-CONTAINED: it uses its own timer (never the shared
  // `timers` array that clearTimers() nukes on case-change / PDF-preview), and a
  // `settleReport()` that always renders the FULL text with no caret. So an interruption
  // (case advance, PDF modal, reduced-motion) can never freeze it half-typed.
  var reportTimer = null, settleReport = null;
  function stopTyping(settle) {
    if (reportTimer) { clearTimeout(reportTimer); reportTimer = null; }
    if (settle && settleReport) settleReport();  // textContent → drops any lingering caret
    settleReport = null;
  }
  function typeReport(rep) {
    stopTyping(false);
    rtec.textContent = rep.tecnica;
    // settle = fully render every section, regardless of how far typing got
    settleReport = function () { rach.textContent = rep.achados; rimp.textContent = rep.impressao; };
    if (reduce) { settleReport(); settleReport = null; return; }
    rach.textContent = ''; rimp.textContent = '';
    typeChain([[rach, rep.achados], [rimp, rep.impressao]], 0);
  }
  function typeChain(items, idx) {
    if (idx >= items.length) { reportTimer = null; settleReport = null; return; }
    var el = items[idx][0], txt = items[idx][1], n = 0,
        step = Math.max(9, Math.min(22, 1400 / txt.length));
    (function tick() {
      n++;
      el.innerHTML = esc(txt.slice(0, n)) + '<span class="caret">.</span>';
      if (n < txt.length) { reportTimer = setTimeout(tick, step); }
      else { el.innerHTML = esc(txt); typeChain(items, idx + 1); }
    })();
  }

  function doSign() {
    if (signbtn.disabled) return;
    signbtn.disabled = true; signed.hidden = false; rv1.textContent = 'Assinado (demonstração)';
    rv2.textContent = DOCTOR.nome + ' · CRM ' + DOCTOR.crm + '/' + DOCTOR.uf;
    lastSignedHuman = fmtNow();
    pdfbtn.hidden = false;
  }

  function updateThumbs() {
    [].forEach.call(thumbs.children, function (t, i) { t.classList.toggle('on', i === cur); });
    var a = thumbs.children[cur];
    if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function show(i) {
    if (!N) return;      // nothing loaded yet (chooser open / session still fetching)
    clearTimers();
    stopTyping(false);   // cancel any in-flight typewriter (sections are cleared below)
    cur = ((i % N) + N) % N;
    var c = cases[cur];
    counter.textContent = pad(cur + 1) + ' / ' + N;
    studyid.textContent = c.id;
    hudmod.textContent = (MOD ? MOD.hud : 'DX') + ' ' + (c.view || 'PA');
    updateThumbs();
    cam.classList.remove('on'); curBox = null; box.hidden = true; box.classList.remove('on');
    signed.hidden = true; signbtn.disabled = false; rv1.textContent = 'Aguardando assinatura';
    rv2.textContent = 'Dr. ____ · CRM ____ / SP'; pdfbtn.hidden = true;
    rtec.textContent = ''; rach.innerHTML = ''; rimp.innerHTML = '';
    xray.src = DATA_ROOT + 'img/' + pad(cur) + '.jpg' + DV;
    cam.src = DATA_ROOT + 'cam/' + pad(cur) + '.png' + DV;
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
      var im = document.createElement('img'); im.src = DATA_ROOT + 'img/' + pad(i) + '.jpg' + DV; im.alt = '';
      t.appendChild(im);
      t.addEventListener('click', function () { show(i); });
      thumbs.appendChild(t);
    });
  }

  playBtn.addEventListener('click', function () {
    playing = !playing; playBtn.textContent = playing ? '❚❚' : '▶';
    if (playing) show(cur); else clearTimers();
  });
  window.addEventListener('resize', function () { if (curBox) placeBox(curBox); });
  prevBtn.addEventListener('click', function () { show(cur - 1); });
  nextBtn.addEventListener('click', function () { show(cur + 1); });
  signbtn.addEventListener('click', doSign);
  pdfbtn.addEventListener('click', function () { generatePdf(cases[cur]); });
  pdfclose.addEventListener('click', closePreview);
  pdfmodal.addEventListener('click', function (e) { if (e.target === pdfmodal) closePreview(); });
  document.addEventListener('keydown', function (e) {
    if (!pdfmodal.hidden) { if (e.key === 'Escape') closePreview(); return; }  // modal open: don't navigate
    if (e.key === 'ArrowRight') show(cur + 1);
    else if (e.key === 'ArrowLeft') show(cur - 1);
    else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  });

  // ---- chooser <-> player: modality boot + clean re-entry ----
  function enter(m) {
    if (!MODS[m]) m = 'chest';
    var seq = ++bootSeq;               // any older in-flight boot becomes a no-op
    modality = m; MOD = MODS[m]; DATA_ROOT = 'data/' + m + '/';
    // hard reset: no stacked timers, no duplicate thumbs, no half-typed report
    clearTimers(); stopTyping(false); closePreview();
    cases = []; N = 0; cur = 0; META = {};
    playing = true; playBtn.textContent = '❚❚';
    thumbs.innerHTML = '';
    cam.classList.remove('on'); cam.removeAttribute('src');
    xray.removeAttribute('src');
    curBox = null; box.hidden = true; box.classList.remove('on');
    findings.innerHTML = ''; rtec.textContent = ''; rach.innerHTML = ''; rimp.innerHTML = '';
    signed.hidden = true; signbtn.disabled = false; pdfbtn.hidden = true;
    rv1.textContent = 'Aguardando assinatura'; rv2.textContent = 'Dr. ____ · CRM ____ / SP';
    counter.textContent = '— / —'; studyid.textContent = '—';
    // modality-fixed chrome (data-independent)
    demotag.textContent = MOD.demo;
    hudsrc.textContent = MOD.src;
    ptag.textContent = MOD.ptag;
    pmeta.textContent = MOD.pmeta;
    xray.alt = MOD.alt;
    bmodel.innerHTML = 'modelo <b>' + esc(MOD.model) + '</b>';
    // swap chrome: chooser out, player in
    chooser.hidden = true; viewerEl.hidden = false; controlsEl.hidden = false;
    swapBtn.hidden = false;
    document.body.classList.remove('choosing');
    fetch(DATA_ROOT + 'session.json' + DV).then(function (r) { return r.json(); }).then(function (meta) {
      if (seq !== bootSeq) return;     // user switched exams while this was loading
      META = meta; cases = meta.cases || []; N = cases.length;
      // header is data-driven from the session meta (falls back to the registry)
      bmodel.innerHTML = 'modelo <b>' + esc(meta.model || MOD.model) + '</b>'
        + (meta.benchmark ? ' · ' + esc(meta.benchmark) : '');
      if (!N) { rach.textContent = 'Sem dados de sessão.'; return; }
      buildThumbs();
      show(0);
    }).catch(function () {
      if (seq !== bootSeq) return;
      rach.textContent = 'Falha ao carregar ' + DATA_ROOT + 'session.json (sirva via http).';
    });
  }
  function showChooser() {
    bootSeq++;                          // invalidate any in-flight session fetch
    playing = false; clearTimers(); stopTyping(false);
    if (!pdfmodal.hidden) closePreview();
    modality = null; MOD = null; DATA_ROOT = '';
    cases = []; N = 0; cur = 0; META = {};
    viewerEl.hidden = true; controlsEl.hidden = true; swapBtn.hidden = true;
    document.body.classList.add('choosing');
    chooser.hidden = false;
  }
  swapBtn.addEventListener('click', showChooser);
  [].forEach.call(chooser.querySelectorAll('.ch-card'), function (card) {
    card.addEventListener('click', function () { enter(card.getAttribute('data-m')); });
  });

  // boot: deep-link ?m=chest|limb goes straight in; otherwise the chooser is the entry
  var qm = null;
  try { qm = new URLSearchParams(location.search).get('m'); } catch (e) { /* very old browser: chooser */ }
  if (qm && MODS[qm]) enter(qm);
  else document.body.classList.add('choosing');
})();
