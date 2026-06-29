import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icons } from '@ohif/ui-next';

import filesToStudies from '../Local/filesToStudies';

/**
 * UX-05 — investor/client "Demo" button (multi-modality demo).
 *
 * One click loads a bundled set of ~20 mixed DICOMs (Brain MRI / Chest X-ray /
 * Limb X-ray) entirely client-side, then opens them so the AI panel can classify
 * each by modality and run the appropriate model (chest → proxy-txv-v1 live;
 * brain → brain-age research lane; limb → honest "no model yet"). Reuses the exact
 * proven local-import primitive the `/local` route uses (`filesToStudies`), so the
 * data never leaves the browser and no Orthanc/PACS upload happens.
 *
 * Ships DARK: rendered ONLY when `window.config.blackvoxelDemo.enabled === true`
 * (runtime config from blackvoxel.js → /app-config.js). With the gate off the
 * study-list toolbar is byte-identical to today. Hidden in explicit clinical mode
 * (same research-affordance rule as the DICOM import button). Read window.config
 * directly to avoid coupling platform/app to the blackvoxel-ai extension bundle.
 */

interface DemoConfig {
  enabled?: boolean;
  manifestUrl?: string;
  /** OHIF mode route to open the loaded studies in (default 'viewer' = longitudinal). */
  modePath?: string;
}

interface DemoManifestStudy {
  study_id?: string;
  files?: string[];
}

interface DemoManifest {
  studies?: DemoManifestStudy[];
}

function readDemoConfig(): DemoConfig {
  const cfg = (window as unknown as { config?: { blackvoxelDemo?: unknown } }).config?.blackvoxelDemo;
  return cfg && typeof cfg === 'object' ? (cfg as DemoConfig) : {};
}

/** Resolve a manifest-relative file path against the manifest URL directory. */
function resolveFileUrl(manifestUrl: string, filePath: string): string {
  if (/^(https?:)?\/\//.test(filePath) || filePath.startsWith('/')) {
    return filePath;
  }
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  return base + filePath;
}

async function fetchAsFile(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Falha ao baixar ${url} (${res.status})`);
  }
  const buf = await res.arrayBuffer();
  const name = url.slice(url.lastIndexOf('/') + 1) || 'demo.dcm';
  return new File([buf], name, { type: 'application/dicom' });
}

export function DemoButton(): React.ReactElement | null {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cfg = readDemoConfig();
  // Hidden unless explicitly enabled. NOT mode-gated: the demo loader is a
  // research/demo affordance that must appear whenever the demo is on, regardless
  // of an inherited viewer mode. (Gating on `mode === 'clinical'` previously hid it
  // for any session carrying a stale 'clinical' mode — clinical ships disabled, so
  // such a value is invalid anyway. See useViewerModeStore self-heal.)
  if (cfg.enabled !== true) {
    return null;
  }

  const manifestUrl = typeof cfg.manifestUrl === 'string' && cfg.manifestUrl ? cfg.manifestUrl : '/demo/demo-manifest.json';
  const modePath = typeof cfg.modePath === 'string' && cfg.modePath ? cfg.modePath : 'viewer';

  const onClick = async (): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(manifestUrl);
      if (!res.ok) {
        throw new Error(`Manifesto indisponível (${res.status})`);
      }
      const manifest = (await res.json()) as DemoManifest;
      // Fetch per-study and SKIP any study whose files aren't available, so a
      // deployment that ships only the redistributable subset (e.g. the CC0 limb
      // set, with the share-alike IXI brain set kept local-only) still loads the
      // rest instead of failing the whole demo.
      const files: File[] = [];
      let skipped = 0;
      for (const study of manifest.studies ?? []) {
        const urls = (study.files ?? []).map(f => resolveFileUrl(manifestUrl, f));
        if (urls.length === 0) {
          continue;
        }
        try {
          const studyFiles = await Promise.all(urls.map(fetchAsFile));
          files.push(...studyFiles);
        } catch {
          skipped += 1;
          // eslint-disable-next-line no-console
          console.warn(`[demo] study unavailable, skipping: ${study.study_id ?? '?'}`);
        }
      }
      if (files.length === 0) {
        throw new Error('Nenhum estudo de demonstração disponível.');
      }
      if (skipped > 0) {
        // eslint-disable-next-line no-console
        console.info(`[demo] loaded ${manifest.studies!.length - skipped} studies, skipped ${skipped}`);
      }
      // Same primitive the /local route uses: register instances in the
      // DicomMetadataStore and return the study UIDs. Client-side only.
      const studyUids: string[] = await filesToStudies(files);
      const query = new URLSearchParams();
      studyUids.forEach(id => query.append('StudyInstanceUIDs', id));
      query.append('datasources', 'dicomlocal');
      navigate(`/${modePath}?${decodeURIComponent(query.toString())}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar a demonstração');
      setLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1"
      disabled={loading}
      onClick={onClick}
      title={error ?? 'Carregar estudos de demonstração (Tórax · Cérebro · Membro)'}
    >
      <Icons.Info className="h-4 w-4" />
      {loading ? 'Carregando…' : 'Demo'}
    </Button>
  );
}

export default DemoButton;
