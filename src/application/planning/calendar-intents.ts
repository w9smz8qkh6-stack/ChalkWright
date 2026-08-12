import { contractVersion } from '../../contracts/v1/common.js';
import type {
  CalendarEventFields,
  CalendarMutationIntent,
  CalendarOwnership,
} from '../../contracts/v1/calendar.js';
import type {
  ContractDiagnostic,
  OpaqueId,
} from '../../contracts/v1/common.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import {
  diagnostic,
  epoch,
  stableFingerprint,
  stableId,
  stableSerialize,
} from '../../domain/pure-values.js';

export interface DesiredCalendarEvent extends CalendarEventFields {
  readonly desiredId: OpaqueId;
}
export interface ExistingCalendarEvent extends CalendarEventFields {
  readonly eventReference: OpaqueId;
  readonly ownership?: CalendarOwnership;
}
export interface CalendarIntentPlan {
  readonly fingerprint: string;
  readonly shouldReconcile: boolean;
  readonly intents: readonly CalendarMutationIntent[];
  readonly diagnostics: readonly ContractDiagnostic[];
}

export function desiredCalendarEvents(options: {
  readonly plan: EffectiveDayPlan;
  readonly scopeId: OpaqueId;
  readonly summaries: Readonly<Record<string, string>>;
  readonly description: string;
}): readonly DesiredCalendarEvent[] {
  if (options.plan.verification !== 'verified') return [];
  return options.plan.meetings.flatMap((meeting) => {
    const start = epoch(meeting.officialStartsAt);
    const end = epoch(meeting.officialEndsAt);
    if (start === undefined || end === undefined || start >= end) return [];
    return [
      {
        desiredId: stableId(
          'calendar-event',
          options.scopeId,
          meeting.meetingId,
        ),
        summary: options.summaries[meeting.courseKey] ?? meeting.blockLabel,
        description: options.description,
        startsAt: meeting.officialStartsAt,
        endsAt: meeting.officialEndsAt,
        timeZone: options.plan.timeZone,
      },
    ];
  });
}

function sameFields(
  left: CalendarEventFields,
  right: CalendarEventFields,
): boolean {
  const fields = (value: CalendarEventFields) => ({
    summary: value.summary,
    description: value.description,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    timeZone: value.timeZone,
  });
  return stableSerialize(fields(left)) === stableSerialize(fields(right));
}

function eventFields(value: CalendarEventFields): CalendarEventFields {
  return {
    summary: value.summary,
    description: value.description,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    timeZone: value.timeZone,
  };
}
function ownedBy(
  event: ExistingCalendarEvent,
  ownership: CalendarOwnership,
): boolean {
  return (
    event.ownership?.classification === 'verified-application-owned' &&
    event.ownership.scopeId === ownership.scopeId &&
    event.ownership.ownershipMarker === ownership.ownershipMarker
  );
}

/** Produce inert Calendar decisions; ambiguous or unrelated events are never mutated. */
export function planCalendarReconciliation(options: {
  readonly plan: EffectiveDayPlan;
  readonly desired: readonly DesiredCalendarEvent[];
  readonly existing: readonly ExistingCalendarEvent[];
  readonly ownership: CalendarOwnership;
  readonly previousFingerprint?: string;
  readonly force: boolean;
}): CalendarIntentPlan {
  const diagnostics: ContractDiagnostic[] = [];
  const fingerprint = stableFingerprint({
    date: options.plan.date,
    planId: options.plan.canonicalPlanId,
    desired: options.desired,
  });
  const shouldReconcile =
    options.force || fingerprint !== options.previousFingerprint;
  if (options.plan.verification !== 'verified') {
    return {
      fingerprint,
      shouldReconcile: false,
      intents: [],
      diagnostics: [
        diagnostic(
          'calendar-plan-not-authoritative',
          'error',
          'Calendar intents require a verified effective plan.',
        ),
      ],
    };
  }
  if (!shouldReconcile)
    return { fingerprint, shouldReconcile, intents: [], diagnostics };
  if (
    options.desired.some((event) => {
      const start = epoch(event.startsAt);
      const end = epoch(event.endsAt);
      return start === undefined || end === undefined || start >= end;
    })
  ) {
    return {
      fingerprint,
      shouldReconcile,
      intents: [],
      diagnostics: [
        diagnostic(
          'calendar-interval-invalid',
          'error',
          'A desired Calendar event has an invalid interval.',
        ),
      ],
    };
  }
  const owned = options.existing.filter((event) =>
    ownedBy(event, options.ownership),
  );
  if (owned.length !== options.existing.length)
    diagnostics.push(
      diagnostic(
        'calendar-events-unrelated',
        'info',
        'Unrelated or ambiguously owned events were ignored.',
      ),
    );
  const remaining = new Map(
    owned.map((event) => [event.eventReference, event]),
  );
  const intents: CalendarMutationIntent[] = [];
  for (const desired of [...options.desired].sort((a, b) =>
    a.desiredId.localeCompare(b.desiredId),
  )) {
    const exact = [...remaining.values()]
      .filter((event) => sameFields(event, desired))
      .sort((a, b) => a.eventReference.localeCompare(b.eventReference));
    const keeper = exact[0];
    if (keeper !== undefined) {
      intents.push({
        contractVersion,
        intentId: stableId(
          'calendar-noop',
          options.plan.effectivePlanId,
          keeper.eventReference,
        ),
        planId: options.plan.effectivePlanId,
        notifyAttendees: false,
        kind: 'no-op',
        existingEventReference: keeper.eventReference,
        reason: 'semantic-match',
      });
      remaining.delete(keeper.eventReference);
      for (const duplicate of exact.slice(1)) {
        intents.push({
          contractVersion,
          intentId: stableId(
            'calendar-delete',
            options.plan.effectivePlanId,
            duplicate.eventReference,
          ),
          planId: options.plan.effectivePlanId,
          notifyAttendees: false,
          kind: 'delete',
          ownership: options.ownership,
          existingEventReference: duplicate.eventReference,
          reason: 'obsolete-owned-event',
        });
        remaining.delete(duplicate.eventReference);
      }
      continue;
    }
    const changed = [...remaining.values()]
      .filter((event) => event.summary === desired.summary)
      .sort((a, b) => a.eventReference.localeCompare(b.eventReference))[0];
    if (changed !== undefined) {
      intents.push({
        contractVersion,
        intentId: stableId(
          'calendar-replace',
          options.plan.effectivePlanId,
          changed.eventReference,
        ),
        planId: options.plan.effectivePlanId,
        notifyAttendees: false,
        kind: 'replace',
        ownership: options.ownership,
        existingEventReference: changed.eventReference,
        desired: eventFields(desired),
      });
      remaining.delete(changed.eventReference);
    } else {
      intents.push({
        contractVersion,
        intentId: stableId(
          'calendar-create',
          options.plan.effectivePlanId,
          desired.desiredId,
        ),
        planId: options.plan.effectivePlanId,
        notifyAttendees: false,
        kind: 'create',
        ownership: options.ownership,
        desired: eventFields(desired),
      });
    }
  }
  for (const obsolete of [...remaining.values()].sort((a, b) =>
    a.eventReference.localeCompare(b.eventReference),
  )) {
    intents.push({
      contractVersion,
      intentId: stableId(
        'calendar-delete',
        options.plan.effectivePlanId,
        obsolete.eventReference,
      ),
      planId: options.plan.effectivePlanId,
      notifyAttendees: false,
      kind: 'delete',
      ownership: options.ownership,
      existingEventReference: obsolete.eventReference,
      reason: 'obsolete-owned-event',
    });
  }
  return { fingerprint, shouldReconcile, intents, diagnostics };
}
