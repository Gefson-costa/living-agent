// ================================================================
//  Protected Files — Paths that self-coding must NEVER touch
//
//  Enforced in the patch validator, NOT in the agent itself.
//  The agent cannot disable this protection.
// ================================================================

/**
 * Hardcoded list of paths that self-coding must never modify.
 * Includes safety modules, fitness core, and evolution core.
 */
export const PROTECTED_PATHS = [
  'src/safety/',
  'src/fitness/hybrid-fitness.ts',
  'src/evolution/ecology.ts',
  'src/evolution/evolution-engine.ts',
  'src/evolution/elo-tracker.ts',
] as const;

/**
 * Check if a file path is protected.
 * Matches by prefix — any file under a protected directory is protected.
 *
 * @param filePath - The path to check (relative to project root)
 * @param extraPaths - Additional paths to protect (on top of PROTECTED_PATHS)
 */
export function isProtectedPath(
  filePath: string,
  extraPaths: readonly string[] = [],
): boolean {
  const normalized = normalizePath(filePath);
  const allPaths = [...PROTECTED_PATHS, ...extraPaths];

  for (const protectedPath of allPaths) {
    const normalizedProtected = normalizePath(protectedPath);
    // Directory match (protected path ends with /)
    if (normalizedProtected.endsWith('/')) {
      if (normalized.startsWith(normalizedProtected) || normalized === normalizedProtected.slice(0, -1)) {
        return true;
      }
    } else {
      // Exact file match
      if (normalized === normalizedProtected) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate all file paths in a patch against protected paths.
 * Returns the list of violations (empty if all paths are safe).
 */
export function validatePatchPaths(
  patchFiles: Array<{ path: string }>,
  extraPaths: readonly string[] = [],
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const file of patchFiles) {
    if (isProtectedPath(file.path, extraPaths)) {
      violations.push(file.path);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/** Normalize path separators to forward slashes */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
