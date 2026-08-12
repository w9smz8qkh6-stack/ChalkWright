export interface RetirementDecision {
  readonly parityId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly replacementOrRationale: string;
}

/** Preserve-by-default: no retirement has been approved. */
export const retirementDecisions: readonly RetirementDecision[] = [];
