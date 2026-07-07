/**
 * useActiveModality.ts (MIMPS-41)
 *
 * A `usePatientDemographics`-style hook (same servicesManager-prop pattern, so
 * it works from the AI panels without reaching into OHIF core) that surfaces
 * the active study's DICOM modality. Reads `Modality` off the active display
 * sets and re-reads on DISPLAY_SETS_ADDED.
 *
 * Used to gate the BlackVoxel AI features by modality: only chest-radiograph
 * modalities (CR / DR / DX) are AI-eligible. MR / CT / anything else is
 * transport-only (no proxy-txv-v1 model), so the AI panel is hidden/disabled
 * and NO inference or persisted-result fetch fires for them (MIMPS-41/42).
 */

import { useEffect, useState } from 'react';

/** Chest-radiograph modalities the proxy-txv-v1 lane is trained for. */
export const CXR_MODALITIES: ReadonlySet<string> = new Set(['CR', 'DR', 'DX']);

/** True when `modality` is a chest-radiograph modality (AI-eligible). */
export function isCxrModality(modality: string | null | undefined): boolean {
  return typeof modality === 'string' && CXR_MODALITIES.has(modality.trim().toUpperCase());
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asUpperOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.trim().toUpperCase() : null;
}

/**
 * Generic "first non-null DICOM field across the active display sets" — shared
 * implementation behind `useActiveModality` (field "Modality") and
 * `useActiveBodyPart` (field "BodyPartExamined"). Resolves to null when no
 * display set / service is available, or no display set carries the field.
 */
function useActiveDicomField(servicesManager: unknown, field: string): string | null {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    if (!isObject(servicesManager)) {
      setValue(null);
      return;
    }
    const services = servicesManager.services;
    if (!isObject(services)) {
      setValue(null);
      return;
    }
    const displaySetService = services.displaySetService;
    if (!isObject(displaySetService)) {
      setValue(null);
      return;
    }

    const getActiveDisplaySets = displaySetService.getActiveDisplaySets;
    const subscribe = displaySetService.subscribe;
    const EVENTS = displaySetService.EVENTS;

    const readFieldFromDisplaySet = (displaySet: unknown): string | null => {
      if (!isObject(displaySet)) {
        return null;
      }
      const direct = asUpperOrNull(displaySet[field]);
      if (direct) {
        return direct;
      }
      const instances = displaySet.instances;
      const instance =
        Array.isArray(instances) && instances.length > 0 ? instances[0] : displaySet.instance;
      if (!isObject(instance)) {
        return null;
      }
      return asUpperOrNull(instance[field]);
    };

    const recompute = (): void => {
      if (typeof getActiveDisplaySets !== 'function') {
        setValue(null);
        return;
      }
      const raw = getActiveDisplaySets.call(displaySetService) as unknown;
      const list = Array.isArray(raw) ? raw : [];
      for (const ds of list) {
        const found = readFieldFromDisplaySet(ds);
        if (found) {
          setValue(found);
          return;
        }
      }
      setValue(null);
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
  }, [servicesManager, field]);

  return value;
}

/**
 * Returns the active study's DICOM modality (upper-cased, e.g. "CR" / "MR"),
 * kept in sync with the display-set service. Resolves to null when no display
 * set / service is available.
 *
 * Resolution rule: the FIRST non-null modality across the active display sets.
 * In a single-study viewer session every display set shares the study's
 * modality, so the first hit is the study modality. (A mixed-modality study is
 * vanishingly rare for the CR/DR/DX vs MR/CT split this gate cares about.)
 */
export function useActiveModality(servicesManager?: unknown): string | null {
  return useActiveDicomField(servicesManager, 'Modality');
}

/**
 * Returns the active study's DICOM `BodyPartExamined` (upper-cased, e.g. "CHEST" /
 * "HAND"), same resolution rule as `useActiveModality`. Used alongside modality
 * to disambiguate plain-film lanes that share a Modality code (CR/DR/DX is both
 * chest AND limb — the body part is what tells them apart, see `resolveAiLane`).
 */
export function useActiveBodyPart(servicesManager?: unknown): string | null {
  return useActiveDicomField(servicesManager, 'BodyPartExamined');
}

/** The AI lane a study routes to — which endpoint the panel calls, if any. */
export type AiLane = 'chest' | 'limb' | 'breastus' | 'mammo';

/** BodyPartExamined values routed to the limb lane (limbfrac-fracatlas-v1). */
const LIMB_BODY_PARTS: ReadonlySet<string> = new Set([
  'HAND', 'WRIST', 'FOOT', 'ANKLE', 'LEG', 'ARM', 'FOREARM', 'SHOULDER', 'HIP',
  'KNEE', 'ELBOW', 'EXTREMITY', 'FEMUR', 'TIBIA', 'FIBULA', 'HUMERUS', 'RADIUS',
  'ULNA', 'CLAVICLE', 'PELVIS',
]);

/**
 * Resolve which AI lane (if any) a study routes to, from its DICOM `Modality`
 * and `BodyPartExamined`. Additive/backward-compatible: a plain-film study
 * (CR/DR/DX) with an empty or CHEST-like body part still resolves to `'chest'`
 * — byte-identical to the pre-existing chest-only behavior — and only a
 * RECOGNIZED limb body part is routed away from it (SD-004: never guess a limb
 * read into the chest model, or vice versa). `null` = not AI-eligible (CT/MR/
 * anything without a wired lane yet) — the panel shows its neutral placeholder.
 */
export function resolveAiLane(
  modality: string | null | undefined,
  bodyPartExamined: string | null | undefined
): AiLane | null {
  const m = typeof modality === 'string' ? modality.trim().toUpperCase() : '';
  const bp = typeof bodyPartExamined === 'string' ? bodyPartExamined.trim().toUpperCase() : '';

  if (m === 'MG') {
    return 'mammo';
  }
  if (m === 'US' && bp.includes('BREAST')) {
    return 'breastus';
  }
  if (CXR_MODALITIES.has(m)) {
    if (LIMB_BODY_PARTS.has(bp) || bp.includes('EXTREM')) {
      return 'limb';
    }
    return 'chest'; // empty / CHEST / any unrecognized body part -> chest (existing behavior)
  }
  return null;
}
