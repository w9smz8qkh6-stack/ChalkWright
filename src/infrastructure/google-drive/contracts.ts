export interface DriveGlossaryFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly modifiedTime?: string;
}

export interface DriveGlossaryReadTransport {
  listChildren(request: {
    readonly parentId: string;
    readonly pageToken?: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  }): Promise<{
    readonly files: readonly DriveGlossaryFile[];
    readonly nextPageToken?: string;
  }>;
  downloadCsv(request: {
    readonly fileId: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  }): Promise<Uint8Array>;
}

export class GoogleDriveGlossaryError extends Error {
  constructor(
    readonly code:
      | 'drive-authentication-required'
      | 'drive-authorization-denied'
      | 'drive-file-not-found'
      | 'drive-rate-limited'
      | 'drive-request-timeout'
      | 'drive-read-unavailable',
  ) {
    super(code);
    this.name = 'GoogleDriveGlossaryError';
  }
}
