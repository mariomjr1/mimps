/**
 * demoMode.ts (UX-05 / multi-modality demo) — viewer-side Demo-mode gate.
 *
 * Master switch for the investor/client "Demo" affordances: the one-click Demo
 * button in the study-list toolbar and the per-study classification badge. Ships
 * DARK: default FALSE.
 *
 * Like the worklist gate (and unlike CLINICAL_MODE_ENABLED's build-time
 * `process.env`), this reads `window.config.blackvoxelDemo` — the runtime app
 * config emitted as /app-config.js from `platform/app/public/config/blackvoxel.js`,
 * which loads before the bundle. Toggling it needs no rebuild. With the gate off
 * (default) the study list + panels are byte-identical to today; the metadata
 * classifier still runs the AI panel's lane routing (that is always-on and
 * model-free), but no Demo button or badge column is rendered.
 */

interface BlackVoxelDemoConfig {
  enabled?: boolean;
  manifestUrl?: string | null;
}

function readDemoConfig(): BlackVoxelDemoConfig {
  // window.config is set by /app-config.js (blackvoxel.js) before the bundle
  // mounts. Read defensively — any shape mismatch falls back to OFF.
  const cfg = (globalThis as { config?: { blackvoxelDemo?: unknown } }).config;
  const raw = cfg?.blackvoxelDemo;
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  return raw as BlackVoxelDemoConfig;
}

/**
 * Whether Demo mode is enabled for this deployment. Only the literal boolean
 * `true` enables it; anything else (unset, false, truthy-but-not-true) stays OFF.
 */
export function isDemoEnabled(): boolean {
  return readDemoConfig().enabled === true;
}

/** Where the Demo button fetches the bundled demo manifest (default /demo/demo-manifest.json). */
export function getDemoManifestUrl(): string {
  const configured = readDemoConfig().manifestUrl;
  if (typeof configured === 'string' && configured.length > 0) {
    return configured;
  }
  return '/demo/demo-manifest.json';
}
