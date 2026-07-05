/**
 * useSegmentation — orchestration hook for segmentation inference.
 *
 * Manages the full lifecycle: capture frame → call API → cache → drive UI.
 * Returns {status, result, error, run, toggleOrgan, setShowLabels, setShowCtrLines}.
 *
 * Status values: 'idle' | 'loading' | 'ready' | 'abstained' | 'disabled' | 'error'.
 */

import { useCallback, useMemo } from 'react';

import { useActiveModality } from './useActiveModality';
import {
  InferenceError,
  inferSegmentation,
  type SegmentationInferResponse,
} from '../services/segmentationClient';
import { useSegmentationStore } from '../stores/useSegmentationStore';

interface UseSegmentationReturn {
  status: 'idle' | 'loading' | 'ready' | 'abstained' | 'disabled' | 'error';
  result: SegmentationInferResponse | null;
  error: string | null;
  run: () => Promise<void>;
  toggleOrgan: (organ: 'lung' | 'heart') => void;
  setShowLabels: (show: boolean) => void;
  setShowCtrLines: (show: boolean) => void;
  visibleOrgans: Set<'lung' | 'heart'>;
}

export function useSegmentation(
  imageId: string | null,
  studyUid: string | null,
  seriesUid: string | null,
  imageDataUrl: string | null,
  modality: string | null
): UseSegmentationReturn {
  const { isCxrModality } = useActiveModality();
  const store = useSegmentationStore();

  // Compute the current result, error, and loading state for this image.
  const result = imageId ? store.resultsByImageId.get(imageId) ?? null : null;
  const error = imageId ? store.errorsByImageId.get(imageId) ?? null : null;
  const isLoading = imageId ? store.loadingImageIds.has(imageId) : false;

  // Determine the UI status.
  const status = useMemo<UseSegmentationReturn['status']>(() => {
    if (!isCxrModality(modality)) return 'disabled';
    if (error === 'Segmentation unavailable') return 'disabled';
    if (isLoading) return 'loading';
    if (result?.is_abstained) return 'abstained';
    if (error) return 'error';
    if (result) return 'ready';
    return 'idle';
  }, [isCxrModality, modality, isLoading, result, error]);

  // Orchestration: capture + infer + cache.
  const run = useCallback(async () => {
    if (!imageId || !studyUid || !imageDataUrl) {
      return;
    }

    // Check cache first.
    if (store.resultsByImageId.has(imageId)) {
      return;
    }

    store.setLoading(imageId, true);
    store.setError(imageId, '');

    try {
      const response = await inferSegmentation({
        study_uid: studyUid,
        series_uid: seriesUid ?? undefined,
        modality: modality ?? undefined,
        image_data_url: imageDataUrl,
        image_id: imageId ?? undefined,
      });
      store.setCachedResult(imageId, response);
    } catch (err) {
      const errorMsg =
        err instanceof InferenceError
          ? err.message
          : `Unknown error: ${String(err)}`;
      store.setError(imageId, errorMsg);
    } finally {
      store.setLoading(imageId, false);
    }
  }, [imageId, studyUid, seriesUid, imageDataUrl, modality, store]);

  // UI control callbacks.
  const toggleOrgan = useCallback(
    (organ: 'lung' | 'heart') => {
      store.toggleOrgan(organ);
    },
    [store]
  );

  const setShowLabels = useCallback(
    (show: boolean) => {
      store.setShowLabels(show);
    },
    [store]
  );

  const setShowCtrLines = useCallback(
    (show: boolean) => {
      store.setShowCtrLines(show);
    },
    [store]
  );

  return {
    status,
    result,
    error,
    run,
    toggleOrgan,
    setShowLabels,
    setShowCtrLines,
    visibleOrgans: store.visibleOrgans,
  };
}
