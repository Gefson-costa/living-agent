/** FNV-1a hash — shared utility for habitat matching and other hashing needs */
export function hashString(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Extract a human-readable message from an unknown error value */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
