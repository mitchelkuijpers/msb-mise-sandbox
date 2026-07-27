/**
 * Utility for merging string→string records with later keys overriding earlier.
 */
export function mergeRecord(
  base: Record<string, string>,
  overlay: Record<string, string>,
): Record<string, string> {
  return { ...base, ...overlay };
}
