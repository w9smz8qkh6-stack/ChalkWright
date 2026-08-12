import { displayStates, type DisplayState } from './display.js';

export const visualViewports = [
  {
    id: 'large-tv',
    width: 1920,
    height: 1080,
    status: 'provisional',
  },
  {
    id: 'laptop',
    width: 1366,
    height: 768,
    status: 'provisional',
  },
] as const;

export interface VisualBaselineCase {
  readonly id: string;
  readonly state: DisplayState;
  readonly variants: readonly string[];
  readonly viewportIds: readonly (typeof visualViewports)[number]['id'][];
  readonly evidenceStatus: 'captured-agent-inspected';
  readonly laterGate: string;
}

/** Agent-inspected evidence never implies human or production approval. */
export const visualBaselineManifest: readonly VisualBaselineCase[] =
  displayStates.map((state) => ({
    id: `visual-${state.replaceAll('_', '-')}`,
    state,
    variants:
      state === 'in_class_content'
        ? ['objective', 'bellringer', 'vocabulary', 'generic-card']
        : state === 'dismissal_warning'
          ? ['local-media-ready', 'local-media-delayed']
          : ['default'],
    viewportIds: ['large-tv'],
    evidenceStatus: 'captured-agent-inspected',
    laterGate: 'User visual review and U-010 production viewport confirmation',
  }));
