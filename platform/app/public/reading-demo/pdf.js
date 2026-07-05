/*
 * pdf.js — BlackVoxel CXR reading-session demo: one-page A4 radiology-report PDF.
 * Self-contained browser script (no modules, no build). Requires jsPDF 2.5.2 UMD
 * loaded beforehand as window.jspdf.jsPDF. Attaches a single global: window.BVPdf.
 *
 * Usage: window.BVPdf.generate(caseObj, ctx)  ->  downloads 'laudo-<id>.pdf'
 * Demo document — fictitious patient data, non-diagnostic (SD-004).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- palette
  var INK = [20, 20, 15];        // #14140F
  var TEAL = [31, 94, 87];       // #1F5E57
  var GRAY_LABEL = [128, 128, 122];
  var GRAY_TEXT = [110, 110, 105];
  var GRAY_SOFT = [150, 150, 145];
  var BORDER = [214, 214, 208];
  var FILL_SOFT = [244, 244, 241];
  var FILL_CARD = [251, 251, 249];

  // ---------------------------------------------------------------- geometry
  var PAGE_W = 595.28;
  var PAGE_H = 841.89;
  var M = 44;                    // left/right margin
  var CW = PAGE_W - 2 * M;       // content width (507.28)
  var RX = PAGE_W - M;           // right edge of content (551.28)

  // ------------------------------------------------------- small paint helpers
  function tc(doc, c) { doc.setTextColor(c[0], c[1], c[2]); }
  function fc(doc, c) { doc.setFillColor(c[0], c[1], c[2]); }
  function dc(doc, c) { doc.setDrawColor(c[0], c[1], c[2]); }

  // Approximate Helvetica-Bold advance widths (AFM, per 1000 units) — used only
  // to place adjacent text runs (wordmark ".ai") and to size the finding chip.
  var WB = {
    ' ': 278, '.': 278, ',': 278, '-': 333, '·': 333,
    'a': 556, 'b': 611, 'c': 556, 'd': 611, 'e': 556, 'f': 333, 'g': 611,
    'h': 611, 'i': 278, 'j': 278, 'k': 556, 'l': 278, 'm': 889, 'n': 611,
    'o': 611, 'p': 611, 'q': 611, 'r': 389, 's': 556, 't': 333, 'u': 611,
    'v': 556, 'w': 778, 'x': 556, 'y': 556, 'z': 500,
    'A': 722, 'B': 722, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778,
    'H': 722, 'I': 278, 'J': 556, 'K': 722, 'L': 611, 'M': 833, 'N': 722,
    'O': 778, 'P': 667, 'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722,
    'V': 667, 'W': 944, 'X': 667, 'Y': 667, 'Z': 611
  };
  function estBoldWidth(str, size) {
    var w = 0, i, ch;
    str = String(str || '');
    for (i = 0; i < str.length; i++) {
      ch = str.charAt(i);
      if (WB[ch] !== undefined) { w += WB[ch]; }
      else if (ch >= '0' && ch <= '9') { w += 556; }
      else if (ch !== ch.toLowerCase()) { w += 700; }   // uppercase-ish (incl. accented)
      else { w += 566; }                                // accented lowercase, fallback
    }
    return (w * size) / 1000;
  }

  // ------------------------------------------------ deterministic tiny PRNG
  function seedOf(str) {
    var s = 2166136261, i;
    str = String(str || 'bv');
    for (i = 0; i < str.length; i++) {
      s ^= str.charCodeAt(i);
      s = Math.imul(s, 16777619) >>> 0;
    }
    return s || 1;
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------- handwritten-style squiggle
  // Deterministic (seeded from caseObj.id), teal, ~90pt wide flourish built
  // from cubic bezier segments via doc.lines (deltas relative to current point).
  function drawSignatureSquiggle(doc, x, y, rand) {
    var segs = [];
    var total = 0;
    // opening tall loop (the "capital letter")
    var a0 = 14 + rand() * 5;
    segs.push([2, -a0, 12, -(a0 + 4), 15, -3]);
    total += 15;
    // rolling humps
    var sign = 1, i, sw, amp;
    for (i = 0; i < 5; i++) {
      sw = 9 + rand() * 5;
      amp = 6 + rand() * 8;
      segs.push([sw * 0.3, sign * amp, sw * 0.72, -sign * amp * 0.9, sw, (rand() - 0.5) * 4]);
      sign = -sign;
      total += sw;
    }
    // closing tail flourish
    var tail = Math.max(90 - total, 14);
    segs.push([8, 6 + rand() * 4, tail * 0.55, -(4 + rand() * 6), tail, -2]);

    dc(doc, TEAL);
    doc.setLineWidth(1.3);
    doc.lines(segs, x, y, [1, 1], 'S', false);
    // underline sweep beneath the name stroke
    doc.setLineWidth(1.0);
    doc.lines([[22, 5, 62, -7, 88, -1]], x + 2, y + 5, [1, 1], 'S', false);
  }

  // ------------------------------------------------------------- watermark
  function drawWatermark(doc) {
    try {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.07 }));
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(80);
      tc(doc, [140, 140, 140]);
      doc.text('DEMONSTRAÇÃO', PAGE_W / 2, PAGE_H / 2, { align: 'center', angle: 45 });
      doc.restoreGraphicsState();
    } catch (e) {
      // watermark is decorative — never let it break report generation
      try { doc.restoreGraphicsState(); } catch (e2) { /* noop */ }
    }
  }

  // ============================================================== generator
  function generate(caseObj, ctx) {
    try {
      caseObj = caseObj || {};
      ctx = ctx || {};
      var p = ctx.patient || {};
      var doctor = ctx.doctor || {};
      var model = ctx.model || {};
      var gt = caseObj.gt || {};
      var report = caseObj.report || {};
      var score = Math.max(0, Math.min(1, Number(caseObj.model_score) || 0));
      var view = caseObj.view === 'AP' ? 'AP (ântero-posterior)' : 'PA (póstero-anterior)';

      var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });

      // Watermark first: at 7% opacity it sits beneath everything and can
      // never reduce the legibility of the content drawn on top of it.
      drawWatermark(doc);

      // ------------------------------------------------------------ 1. HEADER
      // Real BlackVoxel tesseract mark — exact geometry from blackvoxel-mark.svg
      // (cube-in-cube hexagon; palette: surface #131318, edge #b9b9c4, links
      // #5d5da0, inner #1c1c3a, accent #8585ff). Matches the viewer's icon.
      (function () {
        var s = 26 / 64, ox = M, oy = 43;
        var X = function (p) { return ox + p * s; }, Y = function (p) { return oy + p * s; };
        var outer = [[32, 9], [51.9, 20.5], [51.9, 43.5], [32, 55], [12.1, 43.5], [12.1, 20.5]];
        var inner = [[32, 21.5], [41.1, 26.75], [41.1, 37.25], [32, 42.5], [22.9, 37.25], [22.9, 26.75]];
        var D = function (p) { var a = [], i; for (i = 1; i < p.length; i++) a.push([(p[i][0] - p[i - 1][0]) * s, (p[i][1] - p[i - 1][1]) * s]); return a; };
        doc.setFillColor(19, 19, 24); doc.setDrawColor(185, 185, 196); doc.setLineWidth(2.5 * s);
        doc.lines(D(outer), X(outer[0][0]), Y(outer[0][1]), [1, 1], 'FD', true);
        doc.setDrawColor(93, 93, 160); doc.setLineWidth(1.5 * s);
        [[[32, 9], [32, 21.5]], [[51.9, 20.5], [41.1, 26.75]], [[51.9, 43.5], [41.1, 37.25]], [[32, 55], [32, 42.5]], [[12.1, 43.5], [22.9, 37.25]], [[12.1, 20.5], [22.9, 26.75]]].forEach(function (c) { doc.line(X(c[0][0]), Y(c[0][1]), X(c[1][0]), Y(c[1][1])); });
        doc.setFillColor(28, 28, 58); doc.setDrawColor(133, 133, 255); doc.setLineWidth(2.5 * s);
        doc.lines(D(inner), X(inner[0][0]), Y(inner[0][1]), [1, 1], 'FD', true);
      })();
      // Wordmark
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      tc(doc, INK);
      doc.text('BlackVoxel', M + 36, 63.5);
      tc(doc, TEAL);
      doc.text('.ai', M + 36 + estBoldWidth('BlackVoxel', 17), 63.5);
      // Right block
      doc.setFontSize(13);
      tc(doc, INK);
      doc.text(ctx.examTitle || 'LAUDO DE TÓRAX', RX, 56, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      tc(doc, TEAL);
      doc.text('assistido por inteligência artificial', RX, 68, { align: 'right' });
      // Teal rule
      dc(doc, TEAL);
      doc.setLineWidth(1.2);
      doc.line(M, 84, RX, 84);

      // ---------------------------------------------------- 2. HONESTY BANNER
      fc(doc, FILL_SOFT);
      doc.rect(M, 92, CW, 16, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      tc(doc, GRAY_TEXT);
      doc.text(
        'DOCUMENTO DE DEMONSTRAÇÃO · dados de paciente fictícios · não constitui diagnóstico',
        PAGE_W / 2, 102.3, { align: 'center' }
      );

      // ------------------------------------------------------ 3. DEMOGRAPHICS
      var boxY = 116;
      var boxH = 138;
      dc(doc, BORDER);
      doc.setLineWidth(1);
      doc.roundedRect(M, boxY, CW, boxH, 6, 6, 'S');

      var sexo = p.sexo === 'M' ? 'Masculino' : (p.sexo === 'F' ? 'Feminino' : (p.sexo || '—'));
      var fields = [
        ['PACIENTE', p.nome],
        ['PRONTUÁRIO', p.prontuario],
        ['NASCIMENTO / IDADE', (p.nascimento || '—') + ' · ' + (p.idade || '—')],
        ['SEXO', sexo],
        ['EXAME', 'Tórax — ' + view],
        ['DATA DO EXAME', p.dataExame],
        ['ACESSO', p.acesso],
        ['MÉDICO SOLICITANTE', p.solicitante],
        ['INSTITUIÇÃO', p.instituicao]
      ];
      var colX = [M + 16, M + 16 + CW / 2];
      var colW = CW / 2 - 30;
      var i, cx, ry, val, lines;
      for (i = 0; i < fields.length; i++) {
        cx = colX[i % 2];
        ry = boxY + 18 + Math.floor(i / 2) * 25;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        tc(doc, GRAY_LABEL);
        doc.text(fields[i][0], cx, ry);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        tc(doc, INK);
        val = String(fields[i][1] || '—');
        lines = doc.splitTextToSize(val, colW);
        doc.text(lines.length > 1 ? lines[0] + '…' : lines[0], cx, ry + 11.5);
      }

      // -------------------------------------------- 4. KEY IMAGE + ACHADO panel
      var rowY = 266;
      var imgW = 190;
      var imgX = RX - imgW;

      // image (or placeholder), thin ink border
      if (ctx.imageDataUrl) {
        try {
          doc.addImage(ctx.imageDataUrl, 'PNG', imgX, rowY, imgW, imgW);
        } catch (imgErr) {
          if (window.console && console.error) { console.error(imgErr); }
          fc(doc, FILL_SOFT);
          doc.rect(imgX, rowY, imgW, imgW, 'F');
        }
      } else {
        fc(doc, FILL_SOFT);
        doc.rect(imgX, rowY, imgW, imgW, 'F');
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        tc(doc, GRAY_SOFT);
        doc.text('imagem indisponível', imgX + imgW / 2, rowY + imgW / 2, { align: 'center' });
      }
      dc(doc, INK);
      doc.setLineWidth(0.9);
      doc.rect(imgX, rowY, imgW, imgW, 'S');

      // caption under the image
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      tc(doc, GRAY_TEXT);
      var capLines = doc.splitTextToSize(
        'Imagem-chave — realce da IA (Grad-CAM) sobre a região do achado.', imgW
      );
      var cy = rowY + imgW + 11;
      for (i = 0; i < capLines.length && i < 2; i++) {
        doc.text(capLines[i], imgX + imgW / 2, cy, { align: 'center' });
        cy += 9.5;
      }

      // "ACHADO" panel, left of the image
      var pw = imgX - 16 - M;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      tc(doc, GRAY_LABEL);
      doc.text('ACHADO PRINCIPAL', M, rowY + 14);

      // teal chip with the finding
      var chipText = String(gt.pt || 'Achado');
      var chipW = Math.min(estBoldWidth(chipText, 9.5) + 20, pw);
      var chipY = rowY + 24;
      fc(doc, TEAL);
      doc.roundedRect(M, chipY, chipW, 19, 9.5, 9.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      tc(doc, [255, 255, 255]);
      doc.text(chipText, M + chipW / 2, chipY + 13, { align: 'center' });

      // model-score bar
      var barY = chipY + 32;
      var barH = 7;
      fc(doc, [232, 232, 228]);
      doc.roundedRect(M, barY, pw, barH, 3.5, 3.5, 'F');
      var fillW = Math.max(pw * score, barH);
      fc(doc, TEAL);
      doc.roundedRect(M, barY, fillW, barH, 3.5, 3.5, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      tc(doc, [70, 70, 64]);
      doc.text('concordância do modelo: ' + (score * 100).toFixed(0) + '%', M, barY + 20);

      // secondary findings
      var secondary = caseObj.secondary || [];
      if (secondary.length) {
        var secText = 'também sinalizado: ' + secondary.map(function (s) {
          return (s.pt || '—') + ' (' + Math.round((Number(s.score) || 0) * 100) + '%)';
        }).join(' · ');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        tc(doc, GRAY_TEXT);
        var secLines = doc.splitTextToSize(secText, pw);
        var sy = barY + 40;
        for (i = 0; i < secLines.length && i < 3; i++) {
          doc.text(secLines[i], M, sy);
          sy += 10.5;
        }
      }

      // ------------------------------------------------------------- 5. LAUDO
      var y = 494;
      var LAUDO_MAX_Y = 674; // hard clamp so the bottom blocks never get overrun
      function section(title, body) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        tc(doc, TEAL);
        doc.text(title, M, y);
        y += 13;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        tc(doc, INK);
        var bl = doc.splitTextToSize(String(body || '—'), CW);
        for (var k = 0; k < bl.length; k++) {
          if (y > LAUDO_MAX_Y) { break; }
          doc.text(bl[k], M, y);
          y += 13;
        }
        y += 9;
      }
      section('TÉCNICA', report.tecnica);
      section('ACHADOS', report.achados);
      section('IMPRESSÃO', report.impressao);

      // -------------------------------------------------------- 6. PROVENANCE
      var sigTop = 702;
      var provText = 'Achados descritivos gerados por ' + (model.name || 'modelo') +
        ' (' + (model.benchmark || '—') + '); rascunho revisado e assinado por médico. ' +
        'Não substitui avaliação clínica.';
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      tc(doc, GRAY_TEXT);
      var provLines = doc.splitTextToSize(provText, CW);
      if (provLines.length > 2) { provLines = provLines.slice(0, 2); }
      var provY = sigTop - 10 - (provLines.length - 1) * 9.5;
      for (i = 0; i < provLines.length; i++) {
        doc.text(provLines[i], M, provY);
        provY += 9.5;
      }

      // ----------------------------------------------- 7. ELECTRONIC SIGNATURE
      var sigH = 90;
      fc(doc, FILL_CARD);
      dc(doc, BORDER);
      doc.setLineWidth(1);
      doc.roundedRect(M, sigTop, CW, sigH, 6, 6, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      tc(doc, GRAY_LABEL);
      doc.text('ASSINATURA ELETRÔNICA', M + 16, sigTop + 15);

      // deterministic handwritten flourish
      var rand = mulberry32(seedOf(caseObj.id));
      drawSignatureSquiggle(doc, M + 24, sigTop + 46, rand);

      // signature line + typed identity beneath the squiggle
      dc(doc, [172, 172, 166]);
      doc.setLineWidth(0.8);
      doc.line(M + 16, sigTop + 53, M + 186, sigTop + 53);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      tc(doc, INK);
      doc.text(String(doctor.nome || '—'), M + 16, sigTop + 66);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      tc(doc, GRAY_TEXT);
      doc.text('CRM ' + (doctor.crm || '—') + '/' + (doctor.uf || '—'), M + 16, sigTop + 78);

      // right column: vector check badge + signed-at + verification hash
      var rbx = M + 258;
      dc(doc, TEAL);
      doc.setLineWidth(1.1);
      doc.roundedRect(rbx, sigTop + 34, 12, 12, 2.5, 2.5, 'S');
      doc.setLineWidth(1.4);
      doc.line(rbx + 3, sigTop + 40.2, rbx + 5.2, sigTop + 42.8);
      doc.line(rbx + 5.2, sigTop + 42.8, rbx + 9.3, sigTop + 37.2);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      tc(doc, INK);
      doc.text('Assinado eletronicamente em ' + (ctx.signedAtHuman || '—'), rbx + 18, sigTop + 43);
      doc.setFontSize(7);
      tc(doc, GRAY_SOFT);
      doc.text(
        'Assinatura eletrônica de demonstração · verificação ' + (ctx.signatureHash || '—'),
        rbx + 18, sigTop + 56
      );

      // ------------------------------------------------------------ 8. FOOTER
      dc(doc, [205, 205, 200]);
      doc.setLineWidth(0.8);
      doc.line(M, 806, RX, 806);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      tc(doc, GRAY_TEXT);
      doc.text('BlackVoxel · MIMPS — laudo de demonstração', M, 816);
      doc.text('1 / 1', PAGE_W / 2, 816, { align: 'center' });
      doc.text('Gerado em ' + (ctx.signedAtHuman || '—'), RX, 816, { align: 'right' });

      // ------ return the built doc; the caller previews it, then downloads ------
      return doc;
    } catch (e) {
      if (window.console && console.error) { console.error(e); }
      alert('Falha ao gerar o PDF.');
      return null;
    }
  }

  window.BVPdf = { generate: generate };
})();
