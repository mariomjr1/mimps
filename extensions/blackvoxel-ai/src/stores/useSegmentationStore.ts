/**
 * Segmentation state store — Zustand.
 *
 * Manages segmentation inference results, visibility toggles (per-organ), and
 * error state. Keyed by imageId — segment once per image, cache the result.
 */

import { create } from 'zustand';

import type { SegmentationInferResponse } from '../services/segmentationClient';

interface SegmentationState {
  // Key: imageId; Value: result (or error/loading state)
  resultsByImageId: Map<string, SegmentationInferResponse | null>;
  loadingImageIds: Set<string>;
  errorsByImageId: Map<string, string>;

  // Visibility toggles
  visibleOrgans: Set<'lung' | 'heart'>;
  showLabels: boolean;
  showCtrLines: boolean;

  // Setters
  setCachedResult: (imageId: string, result: SegmentationInferResponse) => void;
  setError: (imageId: string, error: string) => void;
  setLoading: (imageId: string, loading: boolean) => void;
  toggleOrgan: (organ: 'lung' | 'heart') => void;
  setAllOrgans: (visible: boolean) => void;
  setShowLabels: (show: boolean) => void;
  setShowCtrLines: (show: boolean) => void;
  clearForImage: (imageId: string) => void;
}

export const useSegmentationStore = create<SegmentationState>((set) => ({
  resultsByImageId: new Map(),
  loadingImageIds: new Set(),
  errorsByImageId: new Map(),
  visibleOrgans: new Set(['lung', 'heart']),
  showLabels: true,
  showCtrLines: false,

  setCachedResult: (imageId: string, result: SegmentationInferResponse) =>
    set((state) => {
      const newMap = new Map(state.resultsByImageId);
      newMap.set(imageId, result);
      return { resultsByImageId: newMap };
    }),

  setError: (imageId: string, error: string) =>
    set((state) => {
      const newMap = new Map(state.errorsByImageId);
      newMap.set(imageId, error);
      return { errorsByImageId: newMap };
    }),

  setLoading: (imageId: string, loading: boolean) =>
    set((state) => {
      const newSet = new Set(state.loadingImageIds);
      if (loading) {
        newSet.add(imageId);
      } else {
        newSet.delete(imageId);
      }
      return { loadingImageIds: newSet };
    }),

  toggleOrgan: (organ: 'lung' | 'heart') =>
    set((state) => {
      const newSet = new Set(state.visibleOrgans);
      if (newSet.has(organ)) {
        newSet.delete(organ);
      } else {
        newSet.add(organ);
      }
      return { visibleOrgans: newSet };
    }),

  setAllOrgans: (visible: boolean) =>
    set(() => ({
      visibleOrgans: visible ? new Set(['lung', 'heart']) : new Set(),
    })),

  setShowLabels: (show: boolean) => set({ showLabels: show }),
  setShowCtrLines: (show: boolean) => set({ showCtrLines: show }),

  clearForImage: (imageId: string) =>
    set((state) => {
      const newResults = new Map(state.resultsByImageId);
      const newErrors = new Map(state.errorsByImageId);
      const newLoading = new Set(state.loadingImageIds);
      newResults.delete(imageId);
      newErrors.delete(imageId);
      newLoading.delete(imageId);
      return {
        resultsByImageId: newResults,
        errorsByImageId: newErrors,
        loadingImageIds: newLoading,
      };
    }),
}));
