export interface ClassroomCourseWorkPage {
  readonly items: readonly unknown[];
  readonly nextPageToken?: string;
}

export interface ClassroomCourseWorkListRequest {
  readonly providerCourseKey: string;
  readonly pageToken?: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/** The only provider capability admitted into the M-08 adapter. */
export interface ClassroomCourseWorkListTransport {
  listPublishedCourseWork(
    request: ClassroomCourseWorkListRequest,
  ): Promise<ClassroomCourseWorkPage>;
}

export class GoogleClassroomTransportError extends Error {
  constructor(
    readonly code:
      | 'classroom-authentication-required'
      | 'classroom-authorization-denied'
      | 'classroom-course-not-found'
      | 'classroom-rate-limited'
      | 'classroom-request-timeout'
      | 'classroom-read-unavailable',
  ) {
    super(code);
    this.name = 'GoogleClassroomTransportError';
  }
}
