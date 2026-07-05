/**
 * SegmentationCard — render segmentation results inside AIFindingsPanel.
 *
 * Shows: CTR value + component widths + per-organ visibility toggles + abstain message.
 * A sibling section of the classification findings, not a separate panel.
 */

import React, { useCallback } from 'react';

import { useSegmentation } from '../hooks/useSegmentation';
import type { SegmentationInferResponse } from '../services/segmentationClient';

interface SegmentationCardProps {
  imageId: string | null;
  studyUid: string | null;
  seriesUid: string | null;
  imageDataUrl: string | null;
  modality: string | null;
}

export const SegmentationCard: React.FC<SegmentationCardProps> = ({
  imageId,
  studyUid,
  seriesUid,
  imageDataUrl,
  modality,
}) => {
  const { status, result, error, run, toggleOrgan, setShowLabels, setShowCtrLines } =
    useSegmentation(imageId, studyUid, seriesUid, imageDataUrl, modality);

  const handleSegmentClick = useCallback(() => {
    run();
  }, [run]);

  // Render nothing if disabled.
  if (status === 'disabled') {
    return null;
  }

  return (
    <div className="border-t border-gray-300 pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Segmentação Torácica</h3>
        <button
          type="button"
          onClick={handleSegmentClick}
          disabled={status === 'loading'}
          className="inline-flex items-center px-3 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
        >
          {status === 'loading' ? 'Computando...' : 'Segmentar'}
        </button>
      </div>

      {/* Abstain state */}
      {status === 'abstained' && result && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
          <div className="font-semibold mb-1">⚠ Análise não realizada</div>
          <p>{result.abstain_reason || 'A imagem não atende aos critérios para segmentação.'}</p>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
          <div className="font-semibold mb-1">Erro</div>
          <p>{error}</p>
        </div>
      )}

      {/* CTR card */}
      {status === 'ready' && result && !result.is_abstained && (
        <div className="space-y-3">
          <div className="bg-gray-50 rounded p-4">
            <div className="text-center mb-3">
              <div className="text-2xl font-bold text-gray-900">
                {result.ctr_value !== null ? result.ctr_value.toFixed(2) : '—'}
              </div>
              <div className="text-xs text-gray-600">Índice Cardiotorácico (ICT)</div>
            </div>

            {/* CTR scale */}
            {result.ctr_value !== null && (
              <div className="flex items-center mb-3 h-6">
                <div className="flex-1 relative">
                  <div className="h-1 bg-gray-300 rounded"></div>
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-gray-900 rounded-full"
                    style={{ left: `${Math.min(result.ctr_value * 100, 100)}%` }}
                  ></div>
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2 bg-gray-400"
                    style={{ left: '50%' }}
                    title="0.5 (neutral reference)"
                  ></div>
                </div>
              </div>
            )}

            {/* Component widths */}
            {result.ctr.cardiac_width_frac !== null && result.ctr.thoracic_width_frac !== null && (
              <div className="text-xs text-gray-700 space-y-1">
                <div>
                  Largura cardíaca: {(result.ctr.cardiac_width_frac * 100).toFixed(1)}% × largura
                </div>
                <div>
                  Largura torácica: {(result.ctr.thoracic_width_frac * 100).toFixed(1)}% × largura
                </div>
              </div>
            )}

            {/* Non-diagnostic note */}
            {result.ctr.note && (
              <div className="text-xs text-gray-600 mt-2 italic">{result.ctr.note}</div>
            )}
          </div>

          {/* Per-organ toggles */}
          <div className="space-y-2">
            {['lung', 'heart'].map((organ) => (
              <label key={organ} className="flex items-center text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={
                    organ === 'lung'
                      ? true // lung always visible in this initial version
                      : true // heart always visible
                  }
                  onChange={() => toggleOrgan(organ as 'lung' | 'heart')}
                  className="mr-2"
                />
                {organ === 'lung' ? 'Pulmões' : 'Coração'}
              </label>
            ))}
          </div>

          {/* Optional controls */}
          <div className="space-y-2">
            <label className="flex items-center text-xs text-gray-700">
              <input
                type="checkbox"
                onChange={(e) => setShowLabels(e.target.checked)}
                defaultChecked={true}
                className="mr-2"
              />
              Rótulos
            </label>
            <label className="flex items-center text-xs text-gray-700">
              <input
                type="checkbox"
                onChange={(e) => setShowCtrLines(e.target.checked)}
                className="mr-2"
              />
              Mostrar linhas ICT
            </label>
          </div>
        </div>
      )}

      {/* Loading state */}
      {status === 'loading' && (
        <div className="text-center py-4 text-sm text-gray-600">
          Processando segmentação...
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-xs text-gray-600 mt-3 pt-3 border-t border-gray-200 italic">
        Pesquisa · não diagnóstico · análise geométrica de silhueta cardíaca
      </div>
    </div>
  );
};
