import { auth, drive } from '@googleapis/drive';

import { googleDriveGlossaryReadScope } from '../../config/google-drive-glossary.js';
import { readProtectedJson } from '../filesystem/protected-json.js';

import {
  GoogleDriveGlossaryError,
  type DriveGlossaryReadTransport,
} from './contracts.js';

const folderMimeType = 'application/vnd.google-apps.folder';
const fileFields = 'nextPageToken,files(id,name,mimeType,modifiedTime)';

interface NarrowDriveClient {
  readonly files: {
    list(
      params: {
        readonly q: string;
        readonly pageSize: number;
        readonly includeItemsFromAllDrives: true;
        readonly supportsAllDrives: true;
        readonly pageToken?: string;
      },
      options: {
        readonly fields: string;
        readonly retry: false;
        readonly signal: AbortSignal;
        readonly timeout: number;
      },
    ): Promise<{
      readonly data: {
        readonly files?: readonly unknown[];
        readonly nextPageToken?: unknown;
      };
    }>;
    get(
      params: {
        readonly fileId: string;
        readonly alt: 'media';
        readonly supportsAllDrives: true;
      },
      options: {
        readonly responseType: 'arraybuffer';
        readonly retry: false;
        readonly signal: AbortSignal;
        readonly timeout: number;
      },
    ): Promise<{ readonly data: unknown }>;
  };
}

/** Exposes only bounded Drive file listing and CSV-byte retrieval. */
export function createDriveGlossaryReadTransport(
  client: NarrowDriveClient,
): DriveGlossaryReadTransport {
  return {
    async listChildren(request) {
      if (!identifier(request.parentId) || !boundedTimeout(request.timeoutMs))
        throw new GoogleDriveGlossaryError('drive-read-unavailable');
      try {
        const response = await client.files.list(
          {
            q: `'${request.parentId}' in parents and trashed = false`,
            pageSize: 100,
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            ...(request.pageToken === undefined
              ? {}
              : { pageToken: request.pageToken }),
          },
          {
            fields: fileFields,
            retry: false,
            signal: request.signal,
            timeout: request.timeoutMs,
          },
        );
        if (!Array.isArray(response.data.files))
          throw new GoogleDriveGlossaryError('drive-read-unavailable');
        const files = response.data.files.map(parseFile);
        const next = response.data.nextPageToken;
        if (
          next !== undefined &&
          (typeof next !== 'string' || next.length < 1 || next.length > 2_048)
        )
          throw new GoogleDriveGlossaryError('drive-read-unavailable');
        return {
          files,
          ...(typeof next === 'string' ? { nextPageToken: next } : {}),
        };
      } catch (error) {
        if (error instanceof GoogleDriveGlossaryError) throw error;
        throw classify(error, request.signal);
      }
    },
    async downloadCsv(request) {
      if (!identifier(request.fileId) || !boundedTimeout(request.timeoutMs))
        throw new GoogleDriveGlossaryError('drive-read-unavailable');
      try {
        const response = await client.files.get(
          {
            fileId: request.fileId,
            alt: 'media',
            supportsAllDrives: true,
          },
          {
            responseType: 'arraybuffer',
            retry: false,
            signal: request.signal,
            timeout: request.timeoutMs,
          },
        );
        if (
          !(response.data instanceof ArrayBuffer) ||
          response.data.byteLength > 1_000_000
        )
          throw new GoogleDriveGlossaryError('drive-read-unavailable');
        return new Uint8Array(response.data);
      } catch (error) {
        if (error instanceof GoogleDriveGlossaryError) throw error;
        throw classify(error, request.signal);
      }
    },
  };
}

/** Factory intentionally remains separate from operational composition. */
export function createOfficialDriveGlossaryClient(
  authenticatedClient: NonNullable<Parameters<typeof drive>[0]['auth']>,
): NarrowDriveClient {
  return drive({
    version: 'v3',
    auth: authenticatedClient,
  }) as unknown as NarrowDriveClient;
}

interface AuthorizedUserReference {
  readonly version: 1;
  readonly type: 'authorized-user';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly scopes: readonly [typeof googleDriveGlossaryReadScope];
}

/** Reads a Drive-read-only authorized-user reference only for the refresh job. */
export function loadOfficialDriveGlossaryTransport(
  referencePath: string,
): DriveGlossaryReadTransport {
  const reference = readProtectedJson(referencePath, isAuthorizedUserReference);
  const oauth = new auth.OAuth2(reference.clientId, reference.clientSecret);
  oauth.setCredentials({ refresh_token: reference.refreshToken });
  return createDriveGlossaryReadTransport(
    createOfficialDriveGlossaryClient(oauth),
  );
}

function isAuthorizedUserReference(
  value: unknown,
): value is AuthorizedUserReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(',') ===
      'clientId,clientSecret,refreshToken,scopes,type,version' &&
    record.version === 1 &&
    record.type === 'authorized-user' &&
    typeof record.clientId === 'string' &&
    /^[A-Za-z0-9._-]{8,256}\.apps\.googleusercontent\.com$/u.test(
      record.clientId,
    ) &&
    typeof record.clientSecret === 'string' &&
    /^[A-Za-z0-9._-]{8,256}$/u.test(record.clientSecret) &&
    typeof record.refreshToken === 'string' &&
    record.refreshToken.length >= 8 &&
    record.refreshToken.length <= 4_096 &&
    Array.isArray(record.scopes) &&
    record.scopes.length === 1 &&
    record.scopes[0] === googleDriveGlossaryReadScope
  );
}

function parseFile(value: unknown): DriveGlossaryReadTransport extends never
  ? never
  : {
      readonly id: string;
      readonly name: string;
      readonly mimeType: string;
      readonly modifiedTime?: string;
    } {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new GoogleDriveGlossaryError('drive-read-unavailable');
  const record = value as Record<string, unknown>;
  if (
    !identifier(record.id) ||
    !boundedName(record.name) ||
    typeof record.mimeType !== 'string' ||
    record.mimeType.length < 3 ||
    record.mimeType.length > 256 ||
    (record.modifiedTime !== undefined &&
      typeof record.modifiedTime !== 'string')
  )
    throw new GoogleDriveGlossaryError('drive-read-unavailable');
  const id = record.id as string;
  const name = record.name as string;
  const mimeType = record.mimeType as string;
  return {
    id,
    name,
    mimeType,
    ...(typeof record.modifiedTime === 'string'
      ? { modifiedTime: record.modifiedTime }
      : {}),
  };
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,256}$/u.test(value);
}
function boundedName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}
function boundedTimeout(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1_000 &&
    value <= 60_000
  );
}
function classify(
  error: unknown,
  signal: AbortSignal,
): GoogleDriveGlossaryError {
  if (signal.aborted)
    return new GoogleDriveGlossaryError('drive-request-timeout');
  const status =
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { response?: { status?: unknown } }).response?.status ===
      'number'
      ? (error as { response: { status: number } }).response.status
      : undefined;
  if (status === 401)
    return new GoogleDriveGlossaryError('drive-authentication-required');
  if (status === 403)
    return new GoogleDriveGlossaryError('drive-authorization-denied');
  if (status === 404)
    return new GoogleDriveGlossaryError('drive-file-not-found');
  if (status === 429) return new GoogleDriveGlossaryError('drive-rate-limited');
  return new GoogleDriveGlossaryError('drive-read-unavailable');
}

export { folderMimeType };
