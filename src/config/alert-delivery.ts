import { isAbsolute, relative, resolve, sep } from 'node:path';

import { readProtectedJson } from '../infrastructure/filesystem/protected-json.js';

export const alertDeliveryReferenceEnvironmentName =
  'CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE';

export interface TelegramAlertProtectedReferences {
  readonly version: 1;
  readonly botTokenPath: string;
  readonly destinationPath: string;
}

/** Loads paths to two separate protected values without reading either value. */
export function loadTelegramAlertProtectedReferences(
  environment: NodeJS.ProcessEnv = process.env,
  repositoryRoot = process.cwd(),
): TelegramAlertProtectedReferences {
  const referencePath = environment[alertDeliveryReferenceEnvironmentName];
  if (!validExternalPath(referencePath, repositoryRoot))
    throw new Error('alert-delivery-config-invalid');
  let references: TelegramAlertProtectedReferences;
  try {
    references = readProtectedJson(referencePath, isTelegramReferences);
  } catch {
    throw new Error('alert-delivery-config-invalid');
  }
  if (
    references.botTokenPath === references.destinationPath ||
    !validExternalPath(references.botTokenPath, repositoryRoot) ||
    !validExternalPath(references.destinationPath, repositoryRoot)
  )
    throw new Error('alert-delivery-config-invalid');
  return references;
}

function isTelegramReferences(
  value: unknown,
): value is TelegramAlertProtectedReferences {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(',') ===
      'botTokenPath,destinationPath,version' &&
    record.version === 1 &&
    typeof record.botTokenPath === 'string' &&
    typeof record.destinationPath === 'string'
  );
}

function validExternalPath(
  value: string | undefined,
  repositoryRoot: string,
): value is string {
  if (
    value === undefined ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === '/'
  )
    return false;
  const relation = relative(resolve(repositoryRoot), value);
  return (
    relation.length > 0 &&
    (relation === '..' ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation))
  );
}
