// Display policy for diagnostic 3D reconstruction.
// High reprojection error is a WARNING, not a reason to hide a triangulated
// point or the bones connected to it. Geometry that cannot be triangulated
// at all is separately reported by the backend in data.rejected.
export const REPROJECTION_WARNING_PX = 10;

export const hasHighReprojectionError = (joint) =>
  Number.isFinite(joint?.rms_reprojection_error_px) &&
  joint.rms_reprojection_error_px > REPROJECTION_WARNING_PX;

export const getReprojectionWarnings = (data) =>
  (data?.joints ?? []).filter(hasHighReprojectionError);
