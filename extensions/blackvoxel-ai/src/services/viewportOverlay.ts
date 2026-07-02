/**
 * viewportOverlay.ts (MIMPS-10)
 *
 * Renders read-only AI bounding boxes on the active Cornerstone3D viewport
 * using the cornerstoneTools annotation state API (same mechanism
 * extensions/cornerstone/src/initMeasurementService.ts uses to hydrate
 * annotations programmatically).
 *
 * Design constraints:
 *  - The box must NOT be editable, movable or deletable by the user. We use a
 *    RectangleROITool subclass with its own toolName ('AIBoundingBox') that is
 *    added to the tool group in `Enabled` mode (rendered, never interactive)
 *    and additionally reports no hit-test proximity. Because the toolName has
 *    no measurement-service mapping, the box also never appears in the
 *    measurements panel.
 *  - Re-running the panel must not duplicate boxes: every UID we add is
 *    tracked and cleared before the next draw (and on panel unmount).
 *  - bounding_box coordinates arrive in image pixel space for a specific
 *    imageId (mapped with imageToWorldCoords); the served Grad-CAM `region` is
 *    normalized to the captured viewport frame and mapped with canvasToWorld.
 *    See cornersForFinding for the coordinate-frame contract (MIMPS-52).
 */

import {
  getEnabledElementByViewportId,
  utilities as csUtils,
} from '@cornerstonejs/core';
import type { Types as CoreTypes } from '@cornerstonejs/core';
import { addTool, annotation as csAnnotation, RectangleROITool } from '@cornerstonejs/tools';
import type { Types as csToolsTypes } from '@cornerstonejs/tools';
import { triggerAnnotationRenderForViewportIds } from '@cornerstonejs/tools/utilities';

import type { InferenceFinding } from './inferenceClient';
import { toPtLabel } from '../utils/labels';

/**
 * Per-finding box hues. Deliberately a cool, brand-adjacent palette — NEVER the
 * clinical traffic-light red/green (SD-004 / CLINICAL_SCOPE): a region-of-
 * attention box must not look like a severity verdict. Colors only disambiguate
 * which box belongs to which finding row; they carry no clinical meaning.
 */
const BOX_PALETTE = [
  '#8585ff', // brand accent (VWR-BRAND-01)
  '#6366F1', // indigo
  '#0EA5E9', // sky
  '#06B6D4', // cyan
  '#8B5CF6', // light violet
  '#3B82F6', // blue
];

/**
 * Stable per-finding key shared with the panel (AIFindingsPanel) so a hover on a
 * findings-list row can highlight the matching box. Derived only from data the
 * panel also has (label + confidence); never depends on render order.
 */
export function findingKey(finding: InferenceFinding): string {
  return `${finding.label}::${finding.confidence}`;
}

/** Resolve a stable box color for a finding from its key (palette by hash). */
export function colorForFinding(finding: InferenceFinding): string {
  const key = findingKey(finding);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return BOX_PALETTE[hash % BOX_PALETTE.length];
}

/**
 * Display-only rectangle: renders like RectangleROI but is invisible to
 * hit-testing, so it can never be selected, dragged or deleted, and it shows
 * the AI label instead of area/mean statistics.
 */
class AIBoundingBoxTool extends RectangleROITool {
  static toolName = 'AIBoundingBox';

  constructor(toolProps = {}, defaultToolProps = undefined) {
    super(toolProps, defaultToolProps);
    // Label text instead of cached stats (area/mean/max).
    this.configuration.getTextLines = (data: { label?: string }) =>
      data?.label ? [data.label] : [];
    // Defense in depth: even if the tool ends up Passive in some tool group,
    // a tool that is never "near" the pointer can't be grabbed or deleted.
    this.isPointNearTool = () => false;
    this.getHandleNearImagePoint = () => undefined;
  }
}

let toolClassRegistered = false;
const activeAnnotationUIDs = new Set<string>();
let lastViewportId: string | null = null;

/**
 * findingKey -> { uid, color } for every box currently drawn, so the panel can
 * highlight the box that matches a hovered findings-list row. Rebuilt on every
 * showAIBoundingBoxes call; cleared by clearAIBoundingBoxes.
 */
const boxByFindingKey = new Map<string, { uid: string; color: string }>();
/** The finding key whose box is currently highlighted, if any. */
let highlightedKey: string | null = null;

/** Base (resting) annotation style for a box of the given color. */
function baseStyleFor(color: string): Record<string, string> {
  return {
    color,
    colorHighlighted: color,
    colorSelected: color,
    colorLocked: color,
    lineDash: '4,4',
    lineWidth: '2',
    textBoxColor: color,
    textBoxColorHighlighted: color,
    textBoxColorSelected: color,
    textBoxColorLocked: color,
  };
}

/**
 * Emphasized style for a hovered box: same hue, solid + thicker line so the
 * highlight reads as "this is the row you're pointing at" without changing the
 * box geometry or implying any new clinical meaning.
 */
function highlightStyleFor(color: string): Record<string, string> {
  return {
    color,
    colorHighlighted: color,
    colorSelected: color,
    colorLocked: color,
    lineDash: '',
    lineWidth: '3.5',
    textBoxColor: color,
    textBoxColorHighlighted: color,
    textBoxColorSelected: color,
    textBoxColorLocked: color,
  };
}

function ensureToolOnViewport(servicesManager: unknown, viewportId: string): boolean {
  const services = (servicesManager as { services?: Record<string, unknown> })?.services;
  const toolGroupService = services?.toolGroupService as
    | {
        getToolGroupForViewport?: (viewportId: string) => {
          hasTool: (toolName: string) => boolean;
          addTool: (toolName: string) => void;
          setToolEnabled: (toolName: string) => void;
        } | void;
      }
    | undefined;

  if (!toolGroupService?.getToolGroupForViewport) {
    return false;
  }

  if (!toolClassRegistered) {
    try {
      addTool(AIBoundingBoxTool);
    } catch (_err) {
      // Already registered globally (e.g. mode re-entry) — fine.
    }
    toolClassRegistered = true;
  }

  const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
  if (!toolGroup) {
    return false;
  }

  if (!toolGroup.hasTool(AIBoundingBoxTool.toolName)) {
    toolGroup.addTool(AIBoundingBoxTool.toolName);
  }
  // Enabled = rendered but never interactive (vs Passive, which still allows
  // manipulation of existing annotations).
  toolGroup.setToolEnabled(AIBoundingBoxTool.toolName);
  return true;
}

/**
 * Removes every AI box previously added by this module and re-renders the
 * viewport they lived on. Safe to call when nothing was drawn.
 */
export function clearAIBoundingBoxes(): void {
  if (activeAnnotationUIDs.size === 0) {
    return;
  }
  for (const uid of activeAnnotationUIDs) {
    try {
      csAnnotation.state.removeAnnotation(uid);
    } catch (_err) {
      // Annotation may already be gone (e.g. study closed) — ignore.
    }
  }
  activeAnnotationUIDs.clear();
  boxByFindingKey.clear();
  highlightedKey = null;

  if (lastViewportId) {
    try {
      triggerAnnotationRenderForViewportIds([lastViewportId]);
    } catch (_err) {
      // Viewport may have been destroyed — nothing to re-render.
    }
    lastViewportId = null;
  }
}

export interface ShowBoundingBoxesArgs {
  servicesManager: unknown;
  /** imageId of the frame the inference ran on (capture source). */
  imageId: string;
  findings: InferenceFinding[];
}

interface BoxViewport {
  canvasToWorld: (p: CoreTypes.Point2) => CoreTypes.Point3;
  element: HTMLElement;
}

/**
 * The four world-space corners of a finding's box (TL, TR, BL, BR), or null.
 *
 * Two coordinate frames, two mappings — this is the fix for MIMPS-52 (box
 * dislocation):
 *
 *  - `bounding_box` is in **image pixel space** for `imageId` → mapped with
 *    `imageToWorldCoords` (unchanged; this path was always correct).
 *  - `region` (the served Grad-CAM lane) is normalized [0,1] to the **captured
 *    viewport frame** — the on-screen canvas that was rasterized and sent to
 *    the model (`AIFindingsPanel` `viewport.getCanvas().toDataURL()`), which
 *    includes letterbox margins and reflects the current pan/zoom/flip. It is
 *    therefore mapped through the viewport's **canvasToWorld**, which natively
 *    inverts exactly that on-screen transform. The old code scaled `region` by
 *    the DICOM image dimensions (`region.x * columns`) and used
 *    `imageToWorldCoords` — correct only when the image exactly filled the
 *    viewport at default zoom, hence "off most of the time".
 *
 * DPR-proof: `canvasToWorld` takes CSS pixels and applies `devicePixelRatio`
 * internally against the backing-store canvas size, while the backend
 * normalized `region` by the backing-store PNG dimensions — so multiplying the
 * normalized region by the element's CSS client size makes every DPR factor
 * cancel.
 */
function cornersForFinding(
  finding: InferenceFinding,
  imageId: string,
  viewport: BoxViewport
): CoreTypes.Point3[] | null {
  const box = finding.bounding_box;
  if (box) {
    return [
      csUtils.imageToWorldCoords(imageId, [box.x, box.y]),
      csUtils.imageToWorldCoords(imageId, [box.x + box.width, box.y]),
      csUtils.imageToWorldCoords(imageId, [box.x, box.y + box.height]),
      csUtils.imageToWorldCoords(imageId, [box.x + box.width, box.y + box.height]),
    ];
  }
  const region = finding.region;
  if (!region) {
    return null;
  }
  const w = viewport.element.clientWidth;
  const h = viewport.element.clientHeight;
  if (!w || !h) {
    return null;
  }
  const toWorld = (fx: number, fy: number): CoreTypes.Point3 =>
    viewport.canvasToWorld([fx * w, fy * h]);
  return [
    toWorld(region.x, region.y),
    toWorld(region.x + region.width, region.y),
    toWorld(region.x, region.y + region.height),
    toWorld(region.x + region.width, region.y + region.height),
  ];
}

/**
 * Draws one read-only dashed violet rectangle per finding that carries a
 * bounding_box. Findings with bounding_box === null are skipped — we never
 * synthesize a localization the model did not produce.
 *
 * Returns the number of boxes drawn.
 */
export function showAIBoundingBoxes({
  servicesManager,
  imageId,
  findings,
}: ShowBoundingBoxesArgs): number {
  // Idempotency: re-runs replace, never stack.
  clearAIBoundingBoxes();

  const localized = findings.filter(f => f.bounding_box != null || f.region != null);
  if (localized.length === 0 || !imageId) {
    return 0;
  }

  const services = (servicesManager as { services?: Record<string, unknown> })?.services;
  const viewportGridService = services?.viewportGridService as
    | { getActiveViewportId?: () => string | undefined }
    | undefined;
  const viewportId = viewportGridService?.getActiveViewportId?.();
  if (!viewportId) {
    return 0;
  }

  const enabledElement = getEnabledElementByViewportId(viewportId);
  if (!enabledElement) {
    return 0;
  }
  const { viewport } = enabledElement;

  if (!ensureToolOnViewport(servicesManager, viewportId)) {
    return 0;
  }

  const FrameOfReferenceUID = viewport.getFrameOfReferenceUID();
  let drawn = 0;

  for (const finding of localized) {
    let corners: CoreTypes.Point3[] | null;
    try {
      corners = cornersForFinding(finding, imageId, viewport as unknown as BoxViewport);
    } catch (err) {
      console.warn('[blackvoxel-ai] could not map bounding box to world coords:', err);
      continue;
    }

    if (!corners || corners.some(corner => !corner)) {
      continue;
    }

    const pct = Math.round(finding.confidence * 100);
    // On-box caption is intentionally non-diagnostic: the "IA:" prefix + the
    // descriptive pt-BR finding + the model-confidence % frame the box as model
    // attention, never a verdict (SD-004 / CLINICAL_SCOPE). Kept verbatim.
    const label = `IA: ${toPtLabel(finding.label)} ${pct}%`;
    const color = colorForFinding(finding);
    const annotationUID = csUtils.uuidv4();

    const aiAnnotation = {
      annotationUID,
      highlighted: false,
      // invalidated MUST be true at add-time: MeasurementService.addUnmappedMeasurement
      // (platform/core) skips invalidated annotations, which keeps this read-only
      // overlay out of the measurements panel (where it would become deletable).
      // Cornerstone resets it to false after the first stats pass.
      invalidated: true,
      isLocked: true,
      isVisible: true,
      metadata: {
        toolName: AIBoundingBoxTool.toolName,
        FrameOfReferenceUID,
        referencedImageId: imageId,
      },
      data: {
        label,
        handles: {
          points: corners,
          activeHandleIndex: null,
          textBox: {
            hasMoved: false,
            worldPosition: [0, 0, 0],
            worldBoundingBox: {
              topLeft: [0, 0, 0],
              topRight: [0, 0, 0],
              bottomLeft: [0, 0, 0],
              bottomRight: [0, 0, 0],
            },
          },
        },
        cachedStats: {},
      },
    } as unknown as csToolsTypes.Annotation;

    csAnnotation.state.addAnnotation(aiAnnotation, viewport.element);
    csAnnotation.locking.setAnnotationLocked(annotationUID, true);
    csAnnotation.config.style.setAnnotationStyles(annotationUID, baseStyleFor(color));

    activeAnnotationUIDs.add(annotationUID);
    // Last box wins on a duplicate key (same label+confidence) — harmless; the
    // hover highlight still lands on a real box for that finding.
    boxByFindingKey.set(findingKey(finding), { uid: annotationUID, color });
    drawn += 1;
  }

  lastViewportId = viewportId;
  triggerAnnotationRenderForViewportIds([viewportId]);
  return drawn;
}

/** Re-render the active viewport's AI boxes, swallowing a destroyed viewport. */
function rerenderBoxes(): void {
  if (!lastViewportId) {
    return;
  }
  try {
    triggerAnnotationRenderForViewportIds([lastViewportId]);
  } catch (_err) {
    // Viewport gone — nothing to re-render.
  }
}

/**
 * Emphasize the box matching `key` (from `findingKey`) and reset any previously
 * highlighted box. Safe no-op when the key has no drawn box (e.g. the finding
 * had no region). Read-only: only the line style changes, never geometry.
 */
export function highlightAIBoundingBox(key: string | null): void {
  if (key === highlightedKey) {
    return;
  }
  // Reset the previously highlighted box to its resting style.
  if (highlightedKey) {
    const prev = boxByFindingKey.get(highlightedKey);
    if (prev) {
      try {
        csAnnotation.config.style.setAnnotationStyles(prev.uid, baseStyleFor(prev.color));
      } catch (_err) {
        // Annotation may be gone — ignore.
      }
    }
  }
  highlightedKey = null;

  if (key) {
    const next = boxByFindingKey.get(key);
    if (next) {
      try {
        csAnnotation.config.style.setAnnotationStyles(next.uid, highlightStyleFor(next.color));
        highlightedKey = key;
      } catch (_err) {
        // Annotation may be gone — leave nothing highlighted.
      }
    }
  }

  rerenderBoxes();
}

/** Clear any active box highlight (resets to resting style). */
export function clearAIHighlight(): void {
  highlightAIBoundingBox(null);
}
