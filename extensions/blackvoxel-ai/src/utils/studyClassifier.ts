/**
 * studyClassifier.ts (MIMPS-43)
 *
 * CONTRACT: canonical source for the multi-modality demo taxonomy.
 * Mirror: 1_platform/backend/services/study_classifier.py
 * (verbatim keyword tables; header comment `# CONTRACT: mirror of studyClassifier.ts §1`).
 * The single design-of-record is
 * agents/research/2026-06-28-multimodality-demo-architecture.md §1 (frozen).
 *
 * What this is: a PURE, deterministic classifier that maps a study's DICOM
 * metadata (`Modality` + `BodyPartExamined` + `StudyDescription`/`SeriesDescription`)
 * to one of four classes. No model is trained or loaded — classification is from
 * metadata only ($0, instant, SD-002-clean, more reliable than a learned image
 * classifier).
 *
 * SD-004 guard: `classifyStudy` is the ONLY thing that selects a model lane. The
 * chest model (proxy-txv-v1) is reachable ONLY for `chest_xray`. A `low`
 * confidence annotates the badge (a `?` suffix) but never blocks routing.
 *
 * The function is dependency-free and side-effect-free so it can run client-side
 * in the viewer (study-list badge + the AI panel lane gate) and be unit-tested in
 * isolation. It is mirrored verbatim in Python for the backend parity test.
 */

/** Class enum — EXACT strings, identical in TS and Python. */
export type StudyClass = 'chest_xray' | 'brain_mri' | 'limb_xray' | 'other';

/** Classification confidence — `low` adds a `?` badge suffix, never blocks routing. */
export type ClassConfidence = 'high' | 'low';

/** Input metadata for one study (any field may be null/absent). */
export interface StudyMeta {
  modality?: string | null;
  bodyPartExamined?: string | null;
  studyDescription?: string | null;
  seriesDescription?: string | null;
}

/** Classification result. */
export interface StudyClassification {
  cls: StudyClass;
  confidence: ClassConfidence;
  /** Short machine-readable reason for the decision branch taken. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Modality sets (§1). XRAY reuses the existing CXR_MODALITIES set; we redeclare
// the strings here so this module stays dependency-free (the Python mirror needs
// the same literal table), but the values are byte-identical to
// useActiveModality.CXR_MODALITIES.
// ---------------------------------------------------------------------------

/** Plain-film X-ray modalities: CR, DR, DX (= CXR_MODALITIES). */
export const XRAY_MODALITIES: ReadonlySet<string> = new Set(['CR', 'DR', 'DX']);

/** MR modalities. */
export const MR_MODALITIES: ReadonlySet<string> = new Set(['MR']);

// ---------------------------------------------------------------------------
// Keyword tables (§1 — accent-folded, UPPER). Substring-matched against the
// folded haystack. Mirrored verbatim in study_classifier.py.
// ---------------------------------------------------------------------------

export const LIMB_KW: readonly string[] = [
  'HAND',
  'WRIST',
  'KNEE',
  'ANKLE',
  'FOOT',
  'FEMUR',
  'TIBIA',
  'FIBULA',
  'RADIUS',
  'ULNA',
  'HUMERUS',
  'ELBOW',
  'SHOULDER',
  'EXTREMITY',
  'FINGER',
  'HIP',
  'FOREARM',
  'LEG',
  'ARM',
  'MAO',
  'PUNHO',
  'JOELHO',
  'TORNOZELO',
  'PE',
  'MEMBRO',
  'COTOVELO',
  'OMBRO',
  'QUADRIL',
  'PERNA',
  'BRACO',
  'ANTEBRACO',
  'DEDO',
  'EXTREMIDADE',
];

export const CHEST_KW: readonly string[] = [
  'CHEST',
  'THORAX',
  'TORAX',
  'LUNG',
  'PULMON',
  'PA AND LAT',
  'CARDIAC',
  'RIBS',
  'TORACICA',
  'PULMAO',
  'COSTELA',
];

export const BRAIN_KW: readonly string[] = [
  'BRAIN',
  'HEAD',
  'SKULL',
  'CRANIO',
  'ENCEFALO',
  'CEREBRO',
  'CEREBRAL',
  'NEURO',
  'CABECA',
  'CRANIANO',
];

// ---------------------------------------------------------------------------
// Normalization (§1)
// ---------------------------------------------------------------------------

/**
 * Accent-fold a string: NFD-decompose, strip combining marks (U+0300–U+036F),
 * trim, and UPPER-case. So `TÓRAX → TORAX`, `Crânio → CRANIO`, `mão → MAO`.
 * Returns '' for null/undefined/empty so callers can concatenate freely.
 */
export function foldAccents(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
}

/** Upper-trim a modality string to '' when absent (modality is NOT accent-folded — it is a code). */
function normalizeModality(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** True when any keyword in `table` is a substring of `haystack`. */
function matchesAny(haystack: string, table: readonly string[]): boolean {
  for (const kw of table) {
    if (kw.length > 0 && haystack.includes(kw)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Classifier (§1 — frozen decision order)
// ---------------------------------------------------------------------------

/**
 * Classify one study from its DICOM metadata, per the FROZEN taxonomy (§1).
 *
 * Decision order (do not reorder — the §6 demo manifest `expected_class` oracle
 * pins this exact sequence):
 *   1. MR → brain keyword ⇒ brain_mri/high; else brain_mri/low (mr-default).
 *   2. XRAY (CR/DR/DX) →
 *        limb-kw & !chest-kw  ⇒ limb_xray/high
 *        chest-kw & !limb-kw  ⇒ chest_xray/high
 *        both                 ⇒ chest_xray/low   (TIE-BREAK: chest wins)
 *        neither              ⇒ chest_xray/low   (xray-default; preserves the
 *                                                 legacy CR→chest behavior)
 *   3. else (CT/US/other/null) ⇒ other/low.
 *
 * The haystack is the accent-folded concatenation of bodyPart + studyDesc +
 * seriesDesc; modality is matched as an upper-cased code against the sets.
 */
export function classifyStudy(meta: StudyMeta): StudyClassification {
  const modality = normalizeModality(meta?.modality);
  const haystack = [
    foldAccents(meta?.bodyPartExamined),
    foldAccents(meta?.studyDescription),
    foldAccents(meta?.seriesDescription),
  ].join(' ');

  // 1. MR → brain.
  if (MR_MODALITIES.has(modality)) {
    if (matchesAny(haystack, BRAIN_KW)) {
      return { cls: 'brain_mri', confidence: 'high', reason: 'mr+brain-kw' };
    }
    return { cls: 'brain_mri', confidence: 'low', reason: 'mr-default' };
  }

  // 2. XRAY → limb / chest, with the chest tie-break + xray-default.
  if (XRAY_MODALITIES.has(modality)) {
    const isLimb = matchesAny(haystack, LIMB_KW);
    const isChest = matchesAny(haystack, CHEST_KW);
    if (isLimb && !isChest) {
      return { cls: 'limb_xray', confidence: 'high', reason: 'xray+limb-kw' };
    }
    if (isChest && !isLimb) {
      return { cls: 'chest_xray', confidence: 'high', reason: 'xray+chest-kw' };
    }
    if (isChest && isLimb) {
      // Tie-break: chest wins (a chest film mentioning a limb is still a chest film).
      return { cls: 'chest_xray', confidence: 'low', reason: 'xray+both-kw-tiebreak-chest' };
    }
    // Neither keyword: default to chest (preserves the legacy CR→chest behavior).
    return { cls: 'chest_xray', confidence: 'low', reason: 'xray-default-chest' };
  }

  // 3. Everything else (CT / US / SM / null / unknown).
  return { cls: 'other', confidence: 'low', reason: 'non-routable-modality' };
}
