export interface CalendarEventListPage {
  readonly items: readonly unknown[];
  readonly nextPageToken?: string;
}

export interface CalendarEventListRequest {
  readonly calendarId: string;
  readonly timeMin: string;
  readonly timeMax: string;
  readonly pageToken?: string;
  readonly maximumResults: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/** The only provider capability admitted into the M-13 audit adapter. */
export interface CalendarEventListTransport {
  listEvents(request: CalendarEventListRequest): Promise<CalendarEventListPage>;
}

export class GoogleCalendarTransportError extends Error {
  constructor(
    readonly code:
      | 'calendar-authentication-required'
      | 'calendar-authorization-denied'
      | 'calendar-not-found'
      | 'calendar-rate-limited'
      | 'calendar-request-timeout'
      | 'calendar-read-unavailable',
  ) {
    super(code);
    this.name = 'GoogleCalendarTransportError';
  }
}
