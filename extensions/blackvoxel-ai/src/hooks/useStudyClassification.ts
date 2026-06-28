/**
 * useStudyClassification.ts (MIMPS-44)
 *
 * A `useActiveModality`-style hook (same servicesManager-prop + DISPLAY_SETS_ADDED
 * subscription) that classifies the active study by its DICOM metadata into the
 * multi-modality demo taxonomy (chest_xray / brain_mri / limb_xray / other) and
 * maps it to a model lane + a display label/icon for the study-list badge and the
 * AI panel's lane routing.
 *
 * It EXTENDS — does not replace — `useActiveModality` (other code imports
 * `isCxrModality`). Classification is metadata-only via `classifyStudy` ($0,
 * SD-002-clean); the chest model is reachable ONLY for the `chest` lane (SD-004).
 *
 * Returns `null` while the modality is unresolved (study/display-sets not loaded
 * yet) so the panel can show a LOADING state rather than guessing a lane — this is
 * what keeps the chest path safe (we never start an inference on an unknown lane,
 * which also avoids the 2026-06-27 cancelled-drop class of bug).
 */

import { useEffect, useState } from 'react';

import { classifyStudy, StudyClass } from '../utils/studyClassifier';

/** Model lane the classification routes to. */
export type ModelLane = 'chest' | 'brain' | 'limb' | 'none';

/** Badge icon key (rendered by StudyClassBadge / the panel). */
export type BadgeIcon = 'lungs' | 'brain' | 'bone' | 'help';

export interface StudyClassInfo {
  cls: StudyClass;
  confidence: 'high' | 'low';
  /** pt-BR display label for the badge. */
  label_pt: string;
  /** English display label. */
  label_en: string;
  badgeIcon: BadgeIcon;
  modelLane: ModelLane;
  /** Optional body-part hint (e.g. "HAND") for a future region-aware limb model. */
  regionHint: string | null;
}

const CLASS_PRESENTATION: Record<
  StudyClass,
  { label_pt: string; label_en: string; badgeIcon: BadgeIcon; modelLane: ModelLane }
> = {
  chest_xray: { label_pt: 'Tórax (RX)', label_en: 'Chest X-ray', badgeIcon: 'lungs', modelLane: 'chest' },
  brain_mri: { label_pt: 'Cérebro (RM)', label_en: 'Brain MRI', badgeIcon: 'brain', modelLane: 'brain' },
  limb_xray: { label_pt: 'Membro (RX)', label_en: 'Limb X-ray', badgeIcon: 'bone', modelLane: 'limb' },
  other: { label_pt: 'Outro', label_en: 'Other', badgeIcon: 'help', modelLane: 'none' },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Read a tag off a display set (its own field, or its first instance). */
function readField(displaySet: Record<string, unknown>, key: string): string | null {
  const direct = asStr(displaySet[key]);
  if (direct) {
    return direct;
  }
  const instances = displaySet.instances;
  const instance =
    Array.isArray(instances) && instances.length > 0 ? instances[0] : displaySet.instance;
  if (!isObject(instance)) {
    return null;
  }
  return asStr(instance[key]);
}

interface StudyMetaRead {
  modality: string | null;
  bodyPartExamined: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
}

/** Pull the classifier-relevant tags off a display set. */
function readMeta(displaySet: unknown): StudyMetaRead | null {
  if (!isObject(displaySet)) {
    return null;
  }
  const modality = readField(displaySet, 'Modality');
  if (!modality) {
    return null; // unresolved — let the hook keep waiting
  }
  return {
    modality,
    bodyPartExamined: readField(displaySet, 'BodyPartExamined'),
    studyDescription: readField(displaySet, 'StudyDescription'),
    seriesDescription: readField(displaySet, 'SeriesDescription'),
  };
}

function buildInfo(meta: StudyMetaRead): StudyClassInfo {
  const { cls, confidence } = classifyStudy({
    modality: meta.modality,
    bodyPartExamined: meta.bodyPartExamined,
    studyDescription: meta.studyDescription,
    seriesDescription: meta.seriesDescription,
  });
  const pres = CLASS_PRESENTATION[cls];
  return {
    cls,
    confidence,
    label_pt: pres.label_pt,
    label_en: pres.label_en,
    badgeIcon: pres.badgeIcon,
    modelLane: pres.modelLane,
    regionHint: meta.bodyPartExamined,
  };
}

/**
 * Classify a study's metadata directly (no React) — used by the study-list badge
 * which already has the QIDO row fields, and unit-testable in isolation.
 */
export function classifyStudyMeta(meta: {
  modality?: string | null;
  bodyPartExamined?: string | null;
  studyDescription?: string | null;
  seriesDescription?: string | null;
}): StudyClassInfo {
  return buildInfo({
    modality: meta.modality ?? null,
    bodyPartExamined: meta.bodyPartExamined ?? null,
    studyDescription: meta.studyDescription ?? null,
    seriesDescription: meta.seriesDescription ?? null,
  });
}

/**
 * Returns the active study's classification (lane + label + icon), kept in sync
 * with the display-set service. Resolves to `null` until a concrete modality is
 * known (study not loaded yet) so the panel shows LOADING, not a guessed lane.
 */
export function useStudyClassification(servicesManager?: unknown): StudyClassInfo | null {
  const [info, setInfo] = useState<StudyClassInfo | null>(null);

  useEffect(() => {
    if (!isObject(servicesManager)) {
      setInfo(null);
      return;
    }
    const services = servicesManager.services;
    if (!isObject(services)) {
      setInfo(null);
      return;
    }
    const displaySetService = services.displaySetService;
    if (!isObject(displaySetService)) {
      setInfo(null);
      return;
    }

    const getActiveDisplaySets = displaySetService.getActiveDisplaySets;
    const subscribe = displaySetService.subscribe;
    const EVENTS = displaySetService.EVENTS;

    const recompute = (): void => {
      if (typeof getActiveDisplaySets !== 'function') {
        setInfo(null);
        return;
      }
      const raw = getActiveDisplaySets.call(displaySetService) as unknown;
      const list = Array.isArray(raw) ? raw : [];
      for (const ds of list) {
        const meta = readMeta(ds);
        if (meta) {
          setInfo(buildInfo(meta));
          return;
        }
      }
      setInfo(null);
    };

    recompute();

    if (typeof subscribe !== 'function' || !isObject(EVENTS)) {
      return;
    }
    const evt = EVENTS.DISPLAY_SETS_ADDED;
    if (typeof evt !== 'string') {
      return;
    }
    const sub = subscribe.call(displaySetService, evt, recompute);
    const unsubscribe =
      isObject(sub) && typeof sub.unsubscribe === 'function'
        ? (sub.unsubscribe as () => void)
        : () => {};
    return () => {
      unsubscribe();
    };
  }, [servicesManager]);

  return info;
}
