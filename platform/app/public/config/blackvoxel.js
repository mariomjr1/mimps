/** @type {AppTypes.Config} */
// MIMPS-07 — production app config for the BlackVoxel viewer.
//
// This file is emitted as /app-config.js by the production build
// (platform/app/package.json -> build:viewer sets APP_CONFIG=config/blackvoxel.js)
// and is loaded at runtime by the deployed dist. It points the viewer at the
// on-box Orthanc via the same-origin DICOMweb path /pacs/dicom-web, served by the
// host nginx -> orthanc-nginx gateway. The gateway injects Orthanc HTTP Basic
// credentials server-side, so the browser never holds Orthanc credentials and no
// CORS round-trip is needed (same origin as the app).
//
// Do NOT point any data source at an external/public demo server here.

// MIMPS-08 — default the UI language to Brazilian Portuguese.
// This script is loaded by index.html BEFORE the app bundle, so seeding the
// i18next detector cache here runs ahead of i18n initialization. The detector
// order is querystring > cookie > localStorage > navigator, so:
//   - first visit: no cached language -> we seed pt-BR and the app boots in pt-BR
//   - returning user who switched language in Preferences: their choice is
//     already cached in localStorage and we leave it alone
//   - ?lng=<locale> in the URL still overrides everything (demo escape hatch)
try {
  if (!window.localStorage.getItem('i18nextLng')) {
    window.localStorage.setItem('i18nextLng', 'pt-BR');
  }
} catch (e) {
  /* storage unavailable (private mode etc.) — fall back to browser detection */
}

window.config = {
  name: 'config/blackvoxel.js',
  routerBasename: null,
  extensions: [],
  modes: [],
  customizationService: {},
  // MIMPS-40 — modality-integration worklist gate (ships DARK, default OFF).
  //
  // The viewer's study list is driven by the QIDO-RS data source below, which
  // already lists every study present in our Orthanc (demo set today; gateway-
  // received studies once DICOM_INGEST_ENABLED is on upstream). So no NEW data
  // source is needed — registry-backed studies appear via the same QIDO path.
  //
  // This block is the VIEWER-side gate for the additive worklist-integration
  // behavior (registry metadata enrichment via the platform worklist API +
  // surfacing the worklist entry point). With `enabled: false` the viewer
  // behaves byte-identically to today: only QIDO/Orthanc drives the list, no
  // platform worklist call fires, demo studies are untouched, and the
  // Research/Clinical mode gate is unchanged. `apiBaseUrl` defaults to the
  // platform origin the inference client already uses (blackvoxel.ai); set it
  // only to point at a non-default platform deployment.
  blackvoxelWorklist: {
    enabled: false,
    apiBaseUrl: null,
  },
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: false, // same-origin: no cross-origin warning needed
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 5,
    prefetch: 25,
  },
  showErrorDetails: 'dev',
  studyPrefetcher: {
    enabled: true,
    displaySetsCount: 2,
    maxNumPrefetchRequests: 10,
    order: 'closest',
  },
  defaultDataSourceName: 'orthancProxy',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthancProxy',
      configuration: {
        friendlyName: 'BlackVoxel PACS (Orthanc)',
        name: 'Orthanc',
        // Same-origin, served by the host nginx /pacs/ block -> orthanc-nginx
        // gateway (Basic auth injected server-side). Relative roots so the
        // viewer works under whatever origin it is served from
        // (https://viewer.blackvoxel.ai in production).
        wadoUriRoot: '/pacs/wado',
        qidoRoot: '/pacs/dicom-web',
        wadoRoot: '/pacs/dicom-web',
        qidoSupportsIncludeField: true,
        supportsReject: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        dicomUploadEnabled: false,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'Abrir DICOM local',
      },
    },
  ],
  httpErrorHandler: error => {
    console.warn(`HTTP Error Handler (status: ${error.status})`, error);
  },
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      // MIMPS-02: absolute paths — a relative './' src breaks on nested
      // routes like /viewer?... where the URL directory is not the root.
      // MOB-02 (V4): mark-only logo below md — the 232px wordmark ate most of
      // a phone-width header/worklist toolbar.
      return React.createElement(
        'span',
        { className: 'flex items-center' },
        React.createElement('img', {
          src: '/blackvoxel-mark.svg',
          alt: 'MIMPS by BlackVoxel',
          className: 'h-6 w-6 md:hidden',
        }),
        React.createElement('img', {
          src: '/blackvoxel-logo.svg',
          alt: 'MIMPS by BlackVoxel',
          className: 'hidden h-[32px] w-[232px] md:block',
        }),
        // Client/investor demo: the live model reading 20 real chest X-rays with
        // Grad-CAM + a pt-BR draft. Opens the standalone reading-session player
        // served as a static asset from /reading-demo (public/reading-demo).
        // Mobile toolbar fix: the full nowrap "▶ Demo IA" chip (inline styles,
        // no responsive handling) overflowed the phone-width worklist toolbar
        // and pushed Settings off-screen. Below md the chip is icon-only (▶),
        // mirroring the mark-only logo pattern above; from md up it renders the
        // full label exactly as before. NOTE: this config file is NOT scanned
        // by Tailwind — only classes already emitted by scanned sources may be
        // used here ('hidden' / 'md:block' are, via Header.tsx et al.).
        React.createElement(
          'a',
          {
            href: '/reading-demo/index.html',
            target: '_blank',
            rel: 'noopener noreferrer',
            title: 'Demonstração — leitura de tórax assistida por IA (20 exames)',
            'aria-label': 'Demo IA',
            style: {
              marginLeft: '14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '.02em',
              textDecoration: 'none',
              color: '#07201c',
              background: '#34c2ac',
              whiteSpace: 'nowrap',
            },
          },
          React.createElement('span', null, '▶'),
          React.createElement('span', { className: 'hidden md:block' }, 'Demo IA')
        )
      );
    },
  },
};
