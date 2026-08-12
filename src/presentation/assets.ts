export interface PresentationAsset {
  readonly publicPath: string;
  readonly repositoryPath: string;
  readonly contentType: string;
  readonly cacheControl: string;
}

export interface DismissalMediaReference {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

/**
 * Static HTTP handlers consume this closed registry instead of resolving
 * request paths against the filesystem.
 */
export const presentationAssetRegistry = {
  '/assets/display.css': {
    publicPath: '/assets/display.css',
    repositoryPath: 'public/display.css',
    contentType: 'text/css; charset=utf-8',
    cacheControl: 'public, max-age=3600',
  },
  '/assets/display.js': {
    publicPath: '/assets/display.js',
    repositoryPath: 'dist/client/display-client.js',
    contentType: 'text/javascript; charset=utf-8',
    cacheControl: 'public, max-age=3600',
  },
  '/assets/chalkwright.svg': {
    publicPath: '/assets/chalkwright.svg',
    repositoryPath: 'public/chalkwright.svg',
    contentType: 'image/svg+xml; charset=utf-8',
    cacheControl: 'public, max-age=86400',
  },
  '/assets/classroom-hub.svg': {
    publicPath: '/assets/classroom-hub.svg',
    repositoryPath: 'public/chalkwright.svg',
    contentType: 'image/svg+xml; charset=utf-8',
    cacheControl: 'public, max-age=86400',
  },
  '/assets/dismissal-poster.svg': {
    publicPath: '/assets/dismissal-poster.svg',
    repositoryPath: 'public/dismissal-poster.svg',
    contentType: 'image/svg+xml; charset=utf-8',
    cacheControl: 'public, max-age=86400',
  },
} as const satisfies Readonly<Record<string, PresentationAsset>>;

export type PresentationAssetPath = keyof typeof presentationAssetRegistry;

/**
 * Deployments may bind these routes to a locally owned, digest-pinned MP4.
 * The distributable application intentionally contains no playable video and
 * always retains the repository-owned poster and bounded text fallback.
 */
export const dismissalMediaContract = {
  publicPath: '/media/dismissal',
  compatibilityPath: '/media/horse.mp4',
  contentType: 'video/mp4',
  posterAssetPath: '/assets/dismissal-poster.svg',
  playableRepositoryFileIncluded: false,
  requirePlayableFileForApplicationReadiness: false,
  fallbackRevealMs: 2_000,
} as const;

export function presentationAsset(path: string): PresentationAsset | undefined {
  return presentationAssetRegistry[path as PresentationAssetPath];
}
