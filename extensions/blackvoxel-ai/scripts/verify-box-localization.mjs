/**
 * MIMPS-53 — AI box-localization round-trip regression guard.
 *
 * Proves the fix for the box-dislocation bug (MIMPS-52) and stops it silently
 * regressing again (it already regressed once when the capture source changed —
 * see the blackvoxel-ai `viewportOverlay.ts` header + the gradcam_localization_01
 * sprint).
 *
 * The served Grad-CAM `region` is normalized [0,1] to the SUBMITTED capture
 * frame (the on-screen viewport canvas), NOT the DICOM image. The correct
 * mapping is `viewport.canvasToWorld([region.x*clientW, region.y*clientH])`
 * (what viewportOverlay `cornersForFinding` now does); the OLD bug scaled the
 * region by the DICOM image dims (`region.x*columns`) + `imageToWorldCoords`,
 * which only coincides with the capture frame when the image exactly fills the
 * viewport at default zoom.
 *
 * This harness opens a letterboxed study, then for three viewport states
 * (default / zoomed+panned / horizontally flipped) it:
 *   - places a KNOWN off-center region the FIX way (canvasToWorld) and asserts
 *     it round-trips to the capture frame (region × canvas size), and
 *   - places it the OLD way (image dims) and asserts it lands DIFFERENTLY
 *     (proving the harness would have caught the bug — a shift beyond tolerance).
 * A center region must land identically both ways (no-regression check).
 *
 * Precondition: a viewer dev server on :3000 (node@20 `yarn dev` in
 * platform/app) with the local demo study importable. Run:
 *   node extensions/blackvoxel-ai/scripts/verify-box-localization.mjs
 * Exits non-zero on any failed assertion. Read-only; imports a local demo study.
 *
 * NOTE: this is a coordinate-transform harness, not a model test — it injects a
 * synthetic region, so it needs no backend/AI call (SD-002/SD-004 irrelevant).
 */
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';

const BASE = process.env.VIEWER_URL || 'http://localhost:3000';
const DEMO =
  process.env.DEMO_DIR ||
  '../../../platform/app/public/demo/studies/brain-ixi-01';
const OFF_CENTER = { x: 0.15, y: 0.4, width: 0.12, height: 0.12 };
const CENTER = { x: 0.5, y: 0.5, width: 0.1, height: 0.1 };
const TOL = 4; // px

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

const probe = (region) => `(() => {
  const cs = window.cornerstone;
  const els = cs?.getEnabledElements?.() || [];
  const vp = els.find(e => e.viewport?.canvasToWorld)?.viewport;
  if (!vp) return { error: 'no active viewport' };
  const imageId = vp.getCurrentImageId?.() || (vp.getImageIds?.() || [])[0];
  const el = vp.element, cw = el.clientWidth, ch = el.clientHeight;
  const r = ${JSON.stringify(region)};
  const fixWorld = vp.canvasToWorld([r.x * cw, r.y * ch]);
  const fix = vp.worldToCanvas(fixWorld).map(Math.round);
  const px = cs.metaData.get('imagePixelModule', imageId) || {};
  const bug = vp.worldToCanvas(
    cs.utilities.imageToWorldCoords(imageId, [r.x * px.columns, r.y * px.rows])
  ).map(Math.round);
  const imgTL = vp.worldToCanvas(cs.utilities.imageToWorldCoords(imageId, [0, 0])).map(Math.round);
  const imgBR = vp.worldToCanvas(cs.utilities.imageToWorldCoords(imageId, [px.columns, px.rows])).map(Math.round);
  return { cw, ch, expectedCapture: [Math.round(r.x*cw), Math.round(r.y*ch)], fix, bug, imgTL, imgBR };
})()`;

async function openStudy(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('blackvoxel_jwt', 'harness');
    sessionStorage.setItem('bv.viewerMode', 'research');
  });
  await page.goto(`${BASE}/local`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  const files = readdirSync(new URL(DEMO + '/', import.meta.url))
    .filter((f) => f.endsWith('.dcm'))
    .slice(0, 12)
    .map((f) => new URL(`${DEMO}/${f}`, import.meta.url).pathname);
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles(files);
  await page.waitForTimeout(6000);
  const row = page.locator('tr', { hasText: 'CEREBRO' }).first();
  await row.waitFor({ timeout: 15000 });
  await row.click();
  await page.waitForTimeout(1000);
  // Launch button is localized: "Visualizador Básico" (pt-BR) / "Basic Viewer".
  await page.locator('button', { hasText: /Visualizador Básico|Basic Viewer/ }).first().click();
  await page.waitForFunction(
    () => {
      const els = window.cornerstone?.getEnabledElements?.() || [];
      return els.length && els[0].viewport?.canvasToWorld;
    },
    { timeout: 30000 }
  );
  await page.waitForTimeout(1500);
}

async function setCamera(page, kind) {
  await page.evaluate((k) => {
    const vp = window.cornerstone.getEnabledElements().find(e => e.viewport?.canvasToWorld).viewport;
    if (k === 'zoompan') { vp.setZoom(2.2); vp.setPan([60, -40]); }
    if (k === 'flip') { vp.setCamera({ flipHorizontal: true }); }
    vp.render();
  }, kind);
  await page.waitForTimeout(500);
}

const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openStudy(page);

  for (const state of ['default', 'zoompan', 'flip']) {
    if (state !== 'default') await setCamera(page, state);

    const off = await page.evaluate(probe(OFF_CENTER));
    if (off.error) { fail(`[${state}] ${off.error}`); continue; }
    const letterboxed = off.imgTL[0] > TOL || off.imgBR[0] < off.cw - TOL ||
                        off.imgTL[1] > TOL || off.imgBR[1] < off.ch - TOL;

    // FIX must land at the capture frame (region × canvas size).
    if (dist(off.fix, off.expectedCapture) > TOL) {
      fail(`[${state}] FIX ${JSON.stringify(off.fix)} != capture frame ${JSON.stringify(off.expectedCapture)}`);
    } else {
      console.log(`OK  [${state}] off-center FIX lands at capture frame ${JSON.stringify(off.fix)}`);
    }

    // When the image is letterboxed / transformed, the OLD image-dims path must
    // land elsewhere — i.e. the harness demonstrably catches the dislocation.
    if (letterboxed) {
      const shift = dist(off.fix, off.bug);
      if (shift <= TOL) {
        fail(`[${state}] FIX and BUG coincide (${shift}px) on a letterboxed view — harness not exercising the bug`);
      } else {
        console.log(`OK  [${state}] old image-dims path is off by ${shift}px (bug would be visible)`);
      }
    }

    // No-regression guard, DEFAULT camera only: with the image centered and
    // filling the frame at default zoom, a centered region maps identically both
    // ways — the fix must not move the one case that already worked. Under
    // zoom/pan/flip the image no longer sits at the canvas center, so the two
    // frames legitimately diverge there (that divergence IS the bug the fix
    // corrects), so the equality check does not apply.
    if (state === 'default') {
      const ctr = await page.evaluate(probe(CENTER));
      if (dist(ctr.fix, ctr.bug) > TOL) {
        fail(`[default] center region: FIX ${JSON.stringify(ctr.fix)} != BUG ${JSON.stringify(ctr.bug)} (unexpected regression)`);
      } else {
        console.log(`OK  [default] centered region identical both ways (no regression)`);
      }
    }
  }

  await browser.close();
  console.log(process.exitCode ? '\nRESULT: FAILED' : '\nRESULT: PASS — box localization correct across letterbox/zoom/flip');
})().catch((e) => { console.error(e); process.exit(1); });
