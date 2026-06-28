/**
 * studyClassifier.test.ts (MIMPS-43)
 *
 * Pins the FROZEN taxonomy (architecture §1) and the §6 demo-manifest
 * `expected_class` oracle. The parity contract is: for every representative
 * `meta`, `classifyStudy(meta).cls === expected_class`. The Python mirror
 * (study_classifier.py) runs the byte-identical table against the same oracle.
 *
 * Coverage:
 *   - all four classes (chest_xray / brain_mri / limb_xray / other),
 *   - accent cases (TÓRAX, CRÂNIO, MÃO — NFD-fold must equal TORAX/CRANIO/MAO),
 *   - the XRAY tie-break (chest wins when both keyword families match),
 *   - the XRAY default (no keyword ⇒ chest, preserving legacy CR→chest),
 *   - the MR default (no brain keyword ⇒ brain_mri/low),
 *   - degradation when description fields are absent (modality-only).
 */

import {
  classifyStudy,
  foldAccents,
  StudyClass,
  StudyMeta,
  LIMB_KW,
  CHEST_KW,
  BRAIN_KW,
  XRAY_MODALITIES,
  MR_MODALITIES,
} from './studyClassifier';

// ---------------------------------------------------------------------------
// §6 demo-manifest oracle — representative rows mirroring the curated demo set.
// Each row's `expected_class` is the test oracle; the parity assertion is exact.
// ---------------------------------------------------------------------------
interface OracleRow {
  name: string;
  meta: StudyMeta;
  expected_class: StudyClass;
  expectedConfidence?: 'high' | 'low';
}

const ORACLE: OracleRow[] = [
  // --- chest_xray ---
  {
    name: 'NIH chest CR (EN)',
    meta: {
      modality: 'CR',
      bodyPartExamined: 'CHEST',
      studyDescription: 'Chest PA and Lateral',
      seriesDescription: 'PA',
    },
    expected_class: 'chest_xray',
    expectedConfidence: 'high',
  },
  {
    name: 'chest DX pt-BR (TÓRAX, accent)',
    meta: {
      modality: 'DX',
      bodyPartExamined: 'TÓRAX',
      studyDescription: 'Radiografia de Tórax',
      seriesDescription: null,
    },
    expected_class: 'chest_xray',
    expectedConfidence: 'high',
  },
  {
    name: 'chest DR pt-BR PULMÃO',
    meta: {
      modality: 'DR',
      bodyPartExamined: 'PULMÃO',
      studyDescription: 'RX de tórax — campos pulmonares',
      seriesDescription: null,
    },
    expected_class: 'chest_xray',
    expectedConfidence: 'high',
  },

  // --- limb_xray ---
  {
    name: 'limb DX hand (EN)',
    meta: {
      modality: 'DX',
      bodyPartExamined: 'HAND',
      studyDescription: 'X-ray Hand AP',
      seriesDescription: 'AP',
    },
    expected_class: 'limb_xray',
    expectedConfidence: 'high',
  },
  {
    name: 'limb DX wrist (EN)',
    meta: {
      modality: 'DX',
      bodyPartExamined: 'WRIST',
      studyDescription: 'Wrist X-ray',
      seriesDescription: null,
    },
    expected_class: 'limb_xray',
    expectedConfidence: 'high',
  },
  {
    name: 'limb DX pt-BR MÃO (accent)',
    meta: {
      modality: 'DX',
      bodyPartExamined: 'MÃO',
      studyDescription: 'Radiografia da mão direita',
      seriesDescription: null,
    },
    expected_class: 'limb_xray',
    expectedConfidence: 'high',
  },
  {
    name: 'limb CR pt-BR JOELHO',
    meta: {
      modality: 'CR',
      bodyPartExamined: 'JOELHO',
      studyDescription: 'RX joelho esquerdo',
      seriesDescription: null,
    },
    expected_class: 'limb_xray',
    expectedConfidence: 'high',
  },

  // --- brain_mri ---
  {
    name: 'brain MR (EN)',
    meta: {
      modality: 'MR',
      bodyPartExamined: 'BRAIN',
      studyDescription: 'MRI Brain',
      seriesDescription: 'T1',
    },
    expected_class: 'brain_mri',
    expectedConfidence: 'high',
  },
  {
    name: 'brain MR pt-BR CRÂNIO (accent)',
    meta: {
      modality: 'MR',
      bodyPartExamined: 'CRÂNIO',
      studyDescription: 'RM de crânio',
      seriesDescription: 'T1 axial',
    },
    expected_class: 'brain_mri',
    expectedConfidence: 'high',
  },
  {
    name: 'brain MR with no brain keyword (mr-default)',
    meta: {
      modality: 'MR',
      bodyPartExamined: null,
      studyDescription: null,
      seriesDescription: null,
    },
    expected_class: 'brain_mri',
    expectedConfidence: 'low',
  },

  // --- other ---
  {
    name: 'CT abdomen (other)',
    meta: {
      modality: 'CT',
      bodyPartExamined: 'ABDOMEN',
      studyDescription: 'CT Abdomen',
      seriesDescription: null,
    },
    expected_class: 'other',
    expectedConfidence: 'low',
  },
  {
    name: 'US (other)',
    meta: {
      modality: 'US',
      bodyPartExamined: null,
      studyDescription: 'Ultrasound',
      seriesDescription: null,
    },
    expected_class: 'other',
    expectedConfidence: 'low',
  },
  {
    name: 'null modality (other)',
    meta: { modality: null, bodyPartExamined: null, studyDescription: null, seriesDescription: null },
    expected_class: 'other',
    expectedConfidence: 'low',
  },
];

describe('classifyStudy — §6 manifest oracle parity', () => {
  it.each(ORACLE)('$name → $expected_class', ({ meta, expected_class, expectedConfidence }) => {
    const result = classifyStudy(meta);
    expect(result.cls).toBe(expected_class);
    if (expectedConfidence) {
      expect(result.confidence).toBe(expectedConfidence);
    }
  });
});

describe('classifyStudy — XRAY tie-break and default branches (§1.2)', () => {
  it('both chest and limb keywords ⇒ chest wins (tie-break), low confidence', () => {
    const result = classifyStudy({
      modality: 'DX',
      bodyPartExamined: 'CHEST',
      // Mentions both a chest term and a limb term (e.g. ribs vs shoulder).
      studyDescription: 'Chest and shoulder X-ray',
      seriesDescription: null,
    });
    expect(result.cls).toBe('chest_xray');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('tiebreak');
  });

  it('XRAY with no keyword ⇒ chest default (preserves legacy CR→chest), low confidence', () => {
    const result = classifyStudy({
      modality: 'CR',
      bodyPartExamined: null,
      studyDescription: null,
      seriesDescription: null,
    });
    expect(result.cls).toBe('chest_xray');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('xray-default');
  });

  it('XRAY modality-only with limb body part still classifies limb (degrades correctly)', () => {
    // QIDO rows often have only modality + a sparse description; the classifier
    // must degrade gracefully, never crash on null description fields.
    const result = classifyStudy({ modality: 'DX', bodyPartExamined: 'ANKLE' });
    expect(result.cls).toBe('limb_xray');
    expect(result.confidence).toBe('high');
  });
});

describe('foldAccents — NFD strip + UPPER (§1 normalization)', () => {
  it.each([
    ['TÓRAX', 'TORAX'],
    ['Tórax', 'TORAX'],
    ['CRÂNIO', 'CRANIO'],
    ['Crânio', 'CRANIO'],
    ['MÃO', 'MAO'],
    ['mão', 'MAO'],
    ['  pulmão  ', 'PULMAO'],
    ['antebraço', 'ANTEBRACO'],
  ])('fold(%s) === %s', (input, expected) => {
    expect(foldAccents(input)).toBe(expected);
  });

  it('folds null/undefined/empty to the empty string', () => {
    expect(foldAccents(null)).toBe('');
    expect(foldAccents(undefined)).toBe('');
    expect(foldAccents('')).toBe('');
  });
});

describe('keyword/modality tables — frozen contents (§1)', () => {
  it('XRAY = {CR, DR, DX}; MR = {MR}', () => {
    expect([...XRAY_MODALITIES].sort()).toEqual(['CR', 'DR', 'DX']);
    expect([...MR_MODALITIES]).toEqual(['MR']);
  });

  it('keyword tables are all-uppercase and accent-free (so substring match is fold-safe)', () => {
    for (const kw of [...LIMB_KW, ...CHEST_KW, ...BRAIN_KW]) {
      expect(kw).toBe(kw.toUpperCase());
      // After folding, the keyword must be unchanged (no latent accents).
      expect(foldAccents(kw)).toBe(kw);
    }
  });

  it('the accent-folded pt-BR keywords are present in their tables', () => {
    expect(LIMB_KW).toContain('MAO');
    expect(LIMB_KW).toContain('ANTEBRACO');
    expect(CHEST_KW).toContain('TORAX');
    expect(CHEST_KW).toContain('PULMAO');
    expect(BRAIN_KW).toContain('CRANIO');
    expect(BRAIN_KW).toContain('CABECA');
  });
});
