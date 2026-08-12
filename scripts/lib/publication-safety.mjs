import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

const ignoredDirectories = new Set([
  '.git',
  '.npm',
  '.test-dist',
  'artifacts',
  'coverage',
  'dist',
  'node_modules',
]);

const textExtensions = new Set([
  '',
  '.css',
  '.example',
  '.html',
  '.in',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.service',
  '.sh',
  '.timer',
  '.toml',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);

const forbiddenPublicText = [
  [['/home', '/bren/'].join(''), 'publication-personal-home-path'],
  [['.openclaw-workonly', '/secrets'].join(''), 'publication-protected-path'],
  [
    ['.codex', '/visualizations/'].join(''),
    'publication-private-evidence-path',
  ],
];

function issue(code, path, count = 1) {
  return { code, path, count };
}

function listFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignoredDirectories.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else files.push(absolute);
    }
  };
  walk(root);
  return files;
}

function readableText(path) {
  if (!textExtensions.has(extname(path))) return undefined;
  const stat = statSync(path);
  if (stat.size > 2_000_000) return undefined;
  return readFileSync(path, 'utf8');
}

function mediaProvenanceIssues(root) {
  const mediaExtensions = new Set(['.gif', '.m4v', '.mov', '.mp4', '.webm']);
  const assets = listFiles(root)
    .filter((path) => mediaExtensions.has(extname(path).toLowerCase()))
    .map((path) => relative(root, path))
    .sort();
  if (assets.length === 0) return [];
  const provenancePath = join(root, 'docs', 'media-provenance.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(provenancePath, 'utf8'));
  } catch {
    return assets.map((asset) =>
      issue('publication-media-provenance-missing', asset),
    );
  }
  const validRights = new Set(['original', 'licensed', 'public-domain']);
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    Object.keys(manifest).sort().join(',') !== 'assets,version' ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length !== assets.length
  ) {
    return [
      issue(
        'publication-media-provenance-invalid',
        'docs/media-provenance.json',
      ),
    ];
  }
  const seen = new Set();
  for (const record of manifest.assets) {
    if (
      record === null ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      Object.keys(record).sort().join(',') !==
        'asset,license,rightsBasis,sha256,source' ||
      typeof record.asset !== 'string' ||
      !assets.includes(record.asset) ||
      seen.has(record.asset) ||
      record.sha256 !==
        createHash('sha256')
          .update(readFileSync(join(root, record.asset)))
          .digest('hex') ||
      !validRights.has(record.rightsBasis) ||
      typeof record.source !== 'string' ||
      record.source.trim().length === 0 ||
      typeof record.license !== 'string' ||
      record.license.trim().length === 0
    )
      return [
        issue(
          'publication-media-provenance-invalid',
          'docs/media-provenance.json',
        ),
      ];
    seen.add(record.asset);
  }
  return [];
}

function previewEvidenceIssues(root) {
  const imageRelative = 'docs/assets/classroom-hub-preview.png';
  const manifestRelative = 'docs/assets/classroom-hub-preview.json';
  const imagePath = join(root, imageRelative);
  const manifestPath = join(root, manifestRelative);
  let image;
  let record;
  try {
    image = readFileSync(imagePath);
    record = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [issue('publication-preview-evidence-missing', manifestRelative)];
  }
  const digest = createHash('sha256').update(image).digest('hex');
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    image.length < 10_000 ||
    image.length > 2_000_000 ||
    !image.subarray(0, pngSignature.length).equals(pngSignature) ||
    record === null ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).sort().join(',') !==
      'browser,consoleErrors,foreignRequests,httpFailures,image,instant,pageErrors,reducedMotion,sha256,source,state,version,viewport' ||
    record.version !== 1 ||
    record.source !== 'repository-owned synthetic B407 fixture' ||
    record.state !== 'pre_checkin' ||
    record.instant !== '2035-04-13T07:55:00Z' ||
    record.browser !== 'Google Chrome 150.0.7871.114' ||
    record.reducedMotion !== true ||
    record.foreignRequests !== 0 ||
    record.consoleErrors !== 0 ||
    record.pageErrors !== 0 ||
    record.httpFailures !== 0 ||
    record.image !== 'classroom-hub-preview.png' ||
    record.sha256 !== digest ||
    record.viewport === null ||
    typeof record.viewport !== 'object' ||
    Array.isArray(record.viewport) ||
    Object.keys(record.viewport).sort().join(',') !== 'height,width' ||
    record.viewport.width !== 1_920 ||
    record.viewport.height !== 1_080
  )
    return [issue('publication-preview-evidence-invalid', manifestRelative)];
  return [];
}

/** Return only path/code/count evidence; never return matched file content. */
export function auditPublicationTree(rootInput) {
  const root = realpathSync(resolve(rootInput));
  const issues = [];
  const requiredAlternatives = [
    ['LICENSE', 'LICENSE.md'],
    ['README.md'],
    ['CONTRIBUTING.md'],
    ['SECURITY.md'],
    ['CODE_OF_CONDUCT.md'],
    ['THIRD_PARTY_NOTICES.md'],
    ['.github/workflows/ci.yml'],
    ['.github/dependabot.yml'],
    ['docs/assets/classroom-hub-preview.png'],
    ['docs/assets/classroom-hub-preview.json'],
  ];

  for (const alternatives of requiredAlternatives) {
    const found = alternatives.some((candidate) => {
      try {
        const path = join(root, candidate);
        return lstatSync(path).isFile() && readFileSync(path).length > 0;
      } catch {
        return false;
      }
    });
    if (!found)
      issues.push(issue('publication-required-file-missing', alternatives[0]));
  }

  for (const absolute of listFiles(root)) {
    const path = relative(root, absolute);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      issues.push(issue('publication-symlink-forbidden', path));
      continue;
    }
    const text = readableText(absolute);
    if (text === undefined) continue;
    for (const [needle, code] of forbiddenPublicText) {
      const count = text.split(needle).length - 1;
      if (count > 0) issues.push(issue(code, path, count));
    }
  }

  const workflowPath = join(root, '.github', 'workflows', 'ci.yml');
  try {
    const workflow = readFileSync(workflowPath, 'utf8');
    const actionUses = [...workflow.matchAll(/uses:\s*[^\s@]+@([^\s#]+)/gu)];
    if (
      actionUses.length === 0 ||
      actionUses.some((match) => !/^[a-f0-9]{40}$/u.test(match[1]))
    ) {
      issues.push(
        issue('publication-ci-action-unpinned', '.github/workflows/ci.yml'),
      );
    }
    if (!/^permissions:\n\s+contents: read$/mu.test(workflow))
      issues.push(
        issue('publication-ci-permissions-invalid', '.github/workflows/ci.yml'),
      );
  } catch {
    // The required-file issue already accounts for an absent workflow.
  }

  issues.push(...mediaProvenanceIssues(root));
  issues.push(...previewEvidenceIssues(root));
  return issues.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.path.localeCompare(right.path),
  );
}

export function publicationSummary(root) {
  const issues = auditPublicationTree(root);
  return {
    status: issues.length === 0 ? 'passed' : 'rejected',
    issueCount: issues.length,
    issues,
    valuesPrinted: 0,
  };
}
