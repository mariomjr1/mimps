# DICOM Conformance Statement — MIMPS / BlackVoxel

**Product:** MIMPS (Medical Imaging Platform by BlackVoxel) — an OHIF v3–based, AI-native web DICOM/PACS
viewer, with the Orthanc DICOMweb backend and the on-prem **BlackVoxel Connect** ingestion gateway.
**Version:** imaging_interop_01 (2026-07-02). **Scope:** descriptive / research / **non-diagnostic**
(SD-004). **Task:** MIMPS-50.

This statement enumerates the SOP classes, transfer syntaxes, and network services the system supports,
so a hospital IT department or modality/PACS vendor can configure send-to-PACS. It consolidates facts
from `platform/app/public/config/blackvoxel.js`, `docker/orthanc.json`,
`docker/orthanc-nginx.conf.template`, and `projects/10_connect/gateway/sop_classes.py` — those files are
authoritative if this document ever drifts.

The system has **three tiers**. A site connects a modality at Tier 3 (or Tier 2); radiologists read at
Tier 1.

---

## Tier 1 — MIMPS viewer (web SCU, DICOMweb)

The viewer is a browser application. It speaks **DICOMweb** to the backend over the same-origin `/pacs/`
proxy; it does not itself implement classic DIMSE.

**Services (as SCU):**
| Service | Supported | Endpoint (via `/pacs/` proxy → Orthanc) |
|---|---|---|
| QIDO-RS (query studies/series/instances) | ✅ | `qidoRoot: /pacs/dicom-web` |
| WADO-RS (retrieve frames/metadata/bulkdata) | ✅ | `wadoRoot: /pacs/dicom-web`, `imageRendering: wadors` |
| WADO-URI (legacy retrieve) | ✅ | `wadoUriRoot: /pacs/wado` |
| STOW-RS (store/upload from the UI) | ⏳ pending **MIMPS-49** | `dicomUploadEnabled` (currently `false`) |

**SOP classes rendered.** The OHIF core stack handler renders **any** modality as a 2-D stack, and
auto-detects reconstructable z-spacing to build **volume + MPR (orthographic)** viewports. With the
DICOM-object extensions enabled (**MIMPS-47**), the viewer also consumes derived objects:

| Category | SOP / modality | Notes |
|---|---|---|
| Projection X-ray | CR, DX, DR | 2-D stack; the live `proxy-txv-v1` chest-X-ray AI lane applies to CR/DX/DR only |
| Cross-sectional | CT, Enhanced CT, MR, Enhanced MR | volume + MPR when reconstructable; CT HU presets + MR (non-calibrated) presets |
| Nuclear / other | PT (SUV presets), US, XA, NM | 2-D / stack |
| Structured Report | DICOM SR (2-D + 3-D) | via `extension-cornerstone-dicom-sr` (MIMPS-47) |
| Segmentation | DICOM SEG | overlay via `extension-cornerstone-dicom-seg` (MIMPS-47) |
| RT Structure Set | RTSTRUCT | contours via `extension-cornerstone-dicom-rt` (MIMPS-47) |
| Parametric Map | PMAP | via `extension-cornerstone-dicom-pmap` (MIMPS-47) |
| Secondary Capture | SC | e.g. Grad-CAM result images |

**Not enabled in this build** (available in OHIF, intentionally off for weight/scope): whole-slide
microscopy, DICOM video, encapsulated PDF, TMTV, 4-D dynamic-volume. Enable per deployment if needed.

**Authentication.** The viewer holds no PACS credentials. The `/pacs/` nginx gateway injects server-side
HTTP Basic auth to Orthanc; where the `full` deployment profile is used, an `auth_request` step verifies
the BlackVoxel RS256 JWT (SSO from the platform) before proxying.

---

## Tier 2 — Orthanc backend (DIMSE ⇄ DICOMweb bridge)

Orthanc is the store. It accepts classic **DIMSE** from on-site PACS/modalities and exposes the same
studies over DICOMweb to the viewer. (Config: `docker/orthanc.json`.)

| Parameter | Value |
|---|---|
| AE Title | `MIMPS` |
| DICOM port (DIMSE) | `4242` |
| DIMSE services (as SCP) | C-STORE, C-FIND, C-MOVE, C-ECHO |
| DICOMweb (REST) | `8042` — QIDO-RS / WADO-RS / STOW-RS enabled |
| TLS | terminated at the edge nginx (`SslEnabled:false` on Orthanc itself) |

A modality or PACS may send directly here (Tier 2) on a trusted network, or via the gateway (Tier 3,
recommended for LGPD de-identification before egress).

---

## Tier 3 — BlackVoxel Connect gateway (on-prem C-STORE SCP)

The recommended ingestion point for a hospital: an on-prem appliance that receives from the modality,
**pseudonymizes for LGPD (PS3.15) before anything leaves the site**, and store-and-forwards to the cloud
Orthanc over STOW-RS/TLS. (Config: `projects/10_connect/gateway/config.py` + `sop_classes.py`; operator
runbook: `projects/10_connect/docs/dicom-conformance-and-modality-setup.md`, task DCM-05.)

| Parameter | Value |
|---|---|
| AE Title | `BVCONNECT` (configurable `BVCONNECT_AET`) |
| DICOM port | `11112` (configurable `BVCONNECT_PORT`) |
| DIMSE services (as SCP) | C-STORE, C-ECHO |
| Health probe | HTTP `:8080` `/health` + `/readyz` |
| Forward | STOW-RS/TLS → cloud Orthanc |

**Accepted SOP classes** (`sop_classes.py`):
| SOP Class | UID | Handling |
|---|---|---|
| Computed Radiography (CR) | 1.2.840.10008.5.1.4.1.1.1 | X-ray → auto-inference eligible |
| Digital X-Ray – Presentation | 1.2.840.10008.5.1.4.1.1.1.1 | X-ray → auto-inference eligible |
| Digital X-Ray – Processing | 1.2.840.10008.5.1.4.1.1.1.1.1 | X-ray → auto-inference eligible |
| MR Image | 1.2.840.10008.5.1.4.1.1.4 | transport + worklist only (no model) |
| Enhanced MR Image | 1.2.840.10008.5.1.4.1.1.4.1 | transport + worklist only |
| CT Image | 1.2.840.10008.5.1.4.1.1.2 | transport + worklist only |
| Enhanced CT Image | 1.2.840.10008.5.1.4.1.1.2.1 | transport + worklist only |
| Secondary Capture | 1.2.840.10008.5.1.4.1.1.7 | e.g. Grad-CAM result images |

**Transfer syntaxes accepted:** Implicit VR Little Endian, Explicit VR Little Endian (uncompressed);
JPEG, JPEG 2000, JPEG-LS (compressed).

---

## Configure your console (quick table)

| Setting | Value to enter on the modality/PACS |
|---|---|
| Destination AE Title | `BVCONNECT` (gateway) or `MIMPS` (direct-to-Orthanc) |
| Destination IP | (site-specific — provided at onboarding) |
| Destination port | `11112` (gateway) or `4242` (Orthanc) |
| Verify connection | send **C-ECHO** first (both accept it) |

Then send one study and confirm it appears in the radiologist worklist / viewer.

---

## Scope & privacy notes
- **Non-diagnostic (SD-004):** AI outputs (chest X-ray `proxy-txv-v1` + Grad-CAM) are descriptive and
  research-only; any generative report lane is gated off. This is not a diagnostic device claim.
- **LGPD:** when the Tier-3 gateway is used, studies are **de-identified/pseudonymized on-prem before
  egress**; the pseudonym map stays on-site; audit records keys/counts only, never pixels or PHI.
- **AI applies to X-ray only:** CT and MR are transported, stored, rendered, and worklisted — no model is
  run on them.
