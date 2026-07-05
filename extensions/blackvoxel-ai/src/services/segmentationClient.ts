/**
 * Segmentation inference client — calls POST /api/v1/segmentation/infer.
 *
 * Mirrors classifyMeasurements() pattern: RS256 auth, 12s timeout (PSPNet slower
 * than DenseNet), graceful error handling (401 → SSO redirect, 503 → disabled state,
 * 422 → bad client input, network error → general error). Returns the full response
 * or throws InferenceError.
 */

export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'InferenceError';
  }
}

export interface SegmentationInferRequest {
  study_uid: string;
  series_uid?: string | null;
  modality?: string | null;
  image_data_url: string; // data:image/...;base64,...
  image_id?: string | null;
  organs?: string[] | null;
}

export interface SegmentationMask {
  lung_mask_png: string; // base64 PNG
  heart_mask_png: string; // base64 PNG
}

export interface CardiothoracicRatio {
  ict: number | null;
  cardiac_width_frac: number | null;
  thoracic_width_frac: number | null;
  measurable: boolean;
  note: string | null;
}

export interface Structure {
  name: string; // "Left Lung" | "Right Lung" | "Heart"
  present: boolean;
}

export interface SegmentationInferResponse {
  study_uid: string;
  model_version: string;
  is_research: boolean;
  inference_time_ms: number;
  is_abstained: boolean;
  abstain_reason: string | null;
  masks: SegmentationMask;
  mask_frame: { width: number; height: number };
  ctr_value: number | null;
  ctr: CardiothoracicRatio;
  structures: Structure[];
  disclaimer: string;
}

export async function inferSegmentation(
  req: SegmentationInferRequest
): Promise<SegmentationInferResponse> {
  // Get JWT from session storage (same key as the classification lane).
  const jwt = sessionStorage.getItem('blackvoxel_jwt');
  if (!jwt) {
    throw new InferenceError('No authentication token in session', 401);
  }

  // Resolve API URL — same logic as classifyMeasurements.
  const baseUrl = readEnv('BLACKVOXEL_API_URL') ?? 'https://blackvoxel.ai';

  // 12s timeout (PSPNet forward is 1–3s, plus network overhead).
  const controller = new AbortController();
  const timeoutMs = 12_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/v1/segmentation/infer`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new InferenceError('Segmentation request timed out', 504);
    }
    throw new InferenceError(`Network error: ${String(err)}`);
  }
  clearTimeout(timeout);

  // Status handling mirrors classify_measurement: 401 → SSO redirect, 503 → disabled,
  // 422 → bad client input, anything else → error.
  if (!res.ok) {
    if (res.status === 401) {
      evictAndRedirectToSSO();
      throw new InferenceError('Unauthorized', 401);
    }
    if (res.status === 503) {
      throw new InferenceError('Segmentation unavailable', 503);
    }
    if (res.status === 422) {
      throw new InferenceError('Invalid image data', 422);
    }
    throw new InferenceError(`API error: ${res.status}`, res.status);
  }

  return res.json() as Promise<SegmentationInferResponse>;
}

/**
 * Read environment variable for the API URL.
 * Falls back to the current window origin if not set.
 */
function readEnv(key: string): string | undefined {
  return import.meta.env[key];
}

/**
 * Evict the JWT and redirect to the login page (handles 401 / token expiry).
 * Stub implementation — integrate with actual auth logic.
 */
function evictAndRedirectToSSO(): void {
  sessionStorage.removeItem('blackvoxel_jwt');
  // Redirect to login page (app-specific logic).
  // Example: window.location.href = '/login';
}
