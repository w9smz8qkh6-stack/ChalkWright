import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';

import { auth, classroom, type classroom_v1 } from '@googleapis/classroom';

import { googleClassroomCourseworkReadScope } from '../../config/google-classroom.js';
import {
  GoogleClassroomTransportError,
  type ClassroomCourseWorkListTransport,
} from './contracts.js';

const maximumCredentialBytes = 16 * 1024;
const classroomFields =
  'nextPageToken,courseWork(id,courseId,title,description,dueDate,dueTime,alternateLink,state,workType,materials,updateTime,creationTime)';

interface AuthorizedUserReference {
  readonly version: 1;
  readonly type: 'authorized-user';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly scopes: readonly [typeof googleClassroomCourseworkReadScope];
}

interface NarrowOfficialClassroomClient {
  readonly courses: {
    readonly courseWork: {
      list(
        params: classroom_v1.Params$Resource$Courses$Coursework$List,
        options: {
          readonly fields: string;
          readonly retry: false;
          readonly signal: AbortSignal;
          readonly timeout: number;
        },
      ): Promise<{ readonly data: classroom_v1.Schema$ListCourseWorkResponse }>;
    };
  };
}

/**
 * Wraps the official generated client behind one GET-only operation. No other
 * generated resource or write method crosses this capability boundary.
 */
export function createClassroomCourseWorkListTransport(
  client: NarrowOfficialClassroomClient,
): ClassroomCourseWorkListTransport {
  return {
    async listPublishedCourseWork(request) {
      try {
        const response = await client.courses.courseWork.list(
          {
            courseId: request.providerCourseKey,
            courseWorkStates: ['PUBLISHED'],
            orderBy: 'dueDate asc,updateTime desc',
            pageSize: 100,
            ...(request.pageToken === undefined
              ? {}
              : { pageToken: request.pageToken }),
          },
          {
            fields: classroomFields,
            retry: false,
            signal: request.signal,
            timeout: request.timeoutMs,
          },
        );
        const items = response.data.courseWork;
        if (items !== undefined && !Array.isArray(items))
          throw new GoogleClassroomTransportError('classroom-read-unavailable');
        const nextPageToken = response.data.nextPageToken;
        if (
          nextPageToken !== undefined &&
          nextPageToken !== null &&
          (typeof nextPageToken !== 'string' || nextPageToken.length > 2_048)
        )
          throw new GoogleClassroomTransportError('classroom-read-unavailable');
        return {
          items: items ?? [],
          ...(typeof nextPageToken === 'string' && nextPageToken.length > 0
            ? { nextPageToken }
            : {}),
        };
      } catch (error: unknown) {
        if (error instanceof GoogleClassroomTransportError) throw error;
        throw classifyGoogleError(error, request.signal);
      }
    },
  };
}

/** Reads a protected authorized-user reference only when a refresh is invoked. */
export function loadOfficialClassroomCourseWorkTransport(
  referencePath: string,
): ClassroomCourseWorkListTransport {
  const reference = loadAuthorizedUserReference(referencePath);
  const oauth = new auth.OAuth2(reference.clientId, reference.clientSecret);
  oauth.setCredentials({ refresh_token: reference.refreshToken });
  const client = classroom({ version: 'v1', auth: oauth });
  return createClassroomCourseWorkListTransport(client);
}

function loadAuthorizedUserReference(path: string): AuthorizedUserReference {
  const effectiveUid = process.geteuid?.();
  if (effectiveUid === undefined)
    throw new Error('classroom-credential-reference-unsafe');
  const before = lstatSync(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.uid !== effectiveUid ||
    (before.mode & 0o077) !== 0 ||
    before.size < 2 ||
    before.size > maximumCredentialBytes ||
    realpathSync(path) !== path
  )
    throw new Error('classroom-credential-reference-unsafe');
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.uid !== effectiveUid ||
      (opened.mode & 0o077) !== 0 ||
      opened.size !== before.size
    )
      throw new Error('classroom-credential-reference-unsafe');
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (!isAuthorizedUserReference(value))
      throw new Error('classroom-credential-reference-invalid');
    return value;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.startsWith('classroom-credential-reference-')
    )
      throw error;
    throw new Error('classroom-credential-reference-invalid');
  } finally {
    closeSync(descriptor);
  }
}

function isAuthorizedUserReference(
  value: unknown,
): value is AuthorizedUserReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !==
      'clientId,clientSecret,refreshToken,scopes,type,version' ||
    record.version !== 1 ||
    record.type !== 'authorized-user' ||
    typeof record.clientId !== 'string' ||
    !/^[A-Za-z0-9._-]{8,256}\.apps\.googleusercontent\.com$/u.test(
      record.clientId,
    ) ||
    typeof record.clientSecret !== 'string' ||
    !/^[A-Za-z0-9._-]{8,256}$/u.test(record.clientSecret) ||
    typeof record.refreshToken !== 'string' ||
    record.refreshToken.length < 8 ||
    record.refreshToken.length > 4_096 ||
    !Array.isArray(record.scopes) ||
    record.scopes.length !== 1 ||
    record.scopes[0] !== googleClassroomCourseworkReadScope
  )
    return false;
  return true;
}

function classifyGoogleError(
  error: unknown,
  signal: AbortSignal,
): GoogleClassroomTransportError {
  if (signal.aborted)
    return new GoogleClassroomTransportError('classroom-request-timeout');
  const status = statusFromError(error);
  if (status === 401)
    return new GoogleClassroomTransportError(
      'classroom-authentication-required',
    );
  if (status === 403)
    return new GoogleClassroomTransportError('classroom-authorization-denied');
  if (status === 404)
    return new GoogleClassroomTransportError('classroom-course-not-found');
  if (status === 429)
    return new GoogleClassroomTransportError('classroom-rate-limited');
  return new GoogleClassroomTransportError('classroom-read-unavailable');
}

function statusFromError(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = (error as { readonly response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return undefined;
  const status = (response as { readonly status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}
