/**
 * Segmentation feature flag — CXR organ masks + CTR inference (MIMPS-28).
 *
 * When disabled, the segmentation card and toolbar button do not render.
 * The backend endpoint respects its own SEG_ENABLED flag; this gates the viewer UI.
 */

export const SEGMENTATION_ENABLED =
  import.meta.env.VITE_SEGMENTATION_ENABLED === 'true' ||
  import.meta.env.BLACKVOXEL_SEGMENTATION_ENABLED === 'true' ||
  false;
