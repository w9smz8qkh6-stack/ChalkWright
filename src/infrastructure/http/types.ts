export type HttpQuery = Readonly<Record<string, string>>;

interface QueryRequest {
  readonly query: HttpQuery;
}

interface ScreenRequest extends QueryRequest {
  readonly screenId: string;
}

export type ClassroomHttpControllerRequest =
  | ({ readonly kind: 'display' } & ScreenRequest)
  | ({ readonly kind: 'displays' } & QueryRequest)
  | ({ readonly kind: 'day-plan' } & ScreenRequest)
  | ({ readonly kind: 'target'; readonly simulation?: true } & ScreenRequest)
  | ({ readonly kind: 'preview' } & ScreenRequest)
  | ({ readonly kind: 'preview-data' } & ScreenRequest)
  | ({ readonly kind: 'overrides.read' } & ScreenRequest)
  | ({
      readonly kind: 'overrides.write';
      readonly body: unknown;
    } & ScreenRequest)
  | ({
      readonly kind: 'overrides.delete';
      readonly body?: unknown;
    } & ScreenRequest)
  | ({ readonly kind: 'hold.read' } & ScreenRequest)
  | ({ readonly kind: 'hold.write'; readonly body: unknown } & ScreenRequest)
  | ({ readonly kind: 'hold.delete'; readonly body?: unknown } & ScreenRequest)
  | ({ readonly kind: 'qr'; readonly meetingId: string } & ScreenRequest)
  | ({ readonly kind: 'manifest' } & QueryRequest)
  | ({ readonly kind: 'health' } & QueryRequest)
  | ({ readonly kind: 'readiness' } & QueryRequest)
  | ({
      readonly kind: 'attendance.class';
      readonly classId: string;
    } & QueryRequest)
  | ({ readonly kind: 'attendance.current' } & ScreenRequest)
  | ({
      readonly kind: 'attendance.diagnostics';
      readonly classId: string;
    } & QueryRequest)
  | ({
      readonly kind: 'attendance.redirect';
      readonly classId: string;
      readonly target: string;
    } & QueryRequest);

export type ClassroomHttpControllerResult =
  | {
      readonly kind: 'json';
      readonly value: unknown;
      readonly status?: number;
    }
  | {
      readonly kind: 'html';
      readonly value: string;
      readonly status?: number;
    }
  | {
      readonly kind: 'binary';
      readonly value: Uint8Array;
      readonly contentType: string;
      readonly status?: number;
    }
  | {
      readonly kind: 'redirect';
      readonly location: string;
      readonly status?: 302 | 303 | 307 | 308;
    };

export interface ClassroomHttpController {
  handle(
    request: ClassroomHttpControllerRequest,
    context: { readonly signal: AbortSignal },
  ):
    | ClassroomHttpControllerResult
    | undefined
    | Promise<ClassroomHttpControllerResult | undefined>;
}

export interface HttpBinaryResource {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface ClassroomHttpServerOptions {
  readonly controller: ClassroomHttpController;
  /** When absent, local mutation routes remain disabled and fail closed. */
  readonly mutationToken?: string;
  readonly media: Readonly<Record<string, HttpBinaryResource>>;
  readonly assets: Readonly<Record<string, HttpBinaryResource>>;
  /** Exact compatibility path to screen identity, for example `/tv`. */
  readonly displayCompatibilityPaths?: Readonly<Record<string, string>>;
  /** Optional exact mount point used to preserve the legacy TV route family. */
  readonly routePrefix?: '/classroom-screen';
  /**
   * Finite aliases for legacy display slugs. Aliases affect only route
   * dispatch; canonical screen identities remain unchanged in responses.
   */
  readonly screenIdAliases?: Readonly<Record<string, string>>;
  /** Enable only the documented legacy `/api/*`, manifest, and media aliases. */
  readonly legacyRouteCompatibility?: boolean;
  readonly host?: '127.0.0.1' | '::1';
  readonly port?: number;
  readonly requestTimeoutMs?: number;
  readonly gracefulCloseTimeoutMs?: number;
  readonly maxBodyBytes?: number;
}

export interface RunningClassroomHttpServer {
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly origin: string;
  close(): Promise<void>;
}
