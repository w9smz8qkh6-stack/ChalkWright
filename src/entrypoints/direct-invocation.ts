import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Compare canonical paths so an approved release symlink still invokes main. */
export function isDirectEntrypoint(
  importMetaUrl: string,
  invokedPath: string | undefined,
): boolean {
  if (invokedPath === undefined) return false;
  try {
    return (
      realpathSync(fileURLToPath(importMetaUrl)) ===
      realpathSync(resolve(invokedPath))
    );
  } catch {
    return false;
  }
}
