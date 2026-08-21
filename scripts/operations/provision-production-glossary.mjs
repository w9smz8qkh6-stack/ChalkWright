import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fchmodSync,
  fchownSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = Object.freeze({
  config: '/home/bren/.config/chalkwright/google-drive-glossary.json',
  credential:
    '/home/bren/.config/chalkwright/google-drive-glossary-authorized-user.json',
});
const target = Object.freeze({
  config: '/etc/chalkwright/production/glossary.json',
  credential:
    '/etc/chalkwright/production/providers/google-drive/authorized-user.json',
  environment: '/etc/chalkwright/production/jobs/glossary-refresh.env',
});
const serviceAccount = Object.freeze({ uid: 972, gid: 972 });
const driveScope = 'https://www.googleapis.com/auth/drive.readonly';

export function buildProductionGlossaryPayload(config, credential) {
  assertCredential(credential);
  return {
    config: buildProductionGlossaryConfig(config),
    credential,
    environment: {
      CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE:
        '/etc/chalkwright/production/server.json',
      CLASSROOM_HUB_GLOSSARY_CONFIG_REFERENCE: target.config,
    },
  };
}

export function buildProductionGlossaryConfig(config) {
  assertConfig(config);
  return {
    ...config,
    credentialReferencePath: target.credential,
  };
}

function main() {
  const operation = process.argv.slice(2).join(' ');
  if (!['--apply', '--replace-config'].includes(operation))
    throw new Error('production-glossary-provision-usage-invalid');
  if (process.geteuid?.() !== 0)
    throw new Error('production-glossary-provision-root-required');
  if (operation === '--replace-config') {
    replaceConfig();
    return;
  }
  if (
    !existsSync('/etc/chalkwright/production/server.json') ||
    Object.values(target).some(existsSync)
  )
    throw new Error('production-glossary-provision-target-invalid');
  const config = JSON.parse(readProtectedSource(source.config));
  const credential = JSON.parse(readProtectedSource(source.credential));
  const payload = buildProductionGlossaryPayload(config, credential);
  const providerDirectory = dirname(target.credential);
  let createdDirectory = false;
  const created = [];
  try {
    if (!existsSync(providerDirectory)) {
      mkdirSync(providerDirectory, { mode: 0o700 });
      chmodSync(providerDirectory, 0o700);
      chownSync(providerDirectory, serviceAccount.uid, serviceAccount.gid);
      createdDirectory = true;
    }
    writeNew(
      target.config,
      `${JSON.stringify(payload.config, null, 2)}\n`,
      serviceAccount.uid,
      serviceAccount.gid,
    );
    created.push(target.config);
    writeNew(
      target.credential,
      `${JSON.stringify(payload.credential, null, 2)}\n`,
      serviceAccount.uid,
      serviceAccount.gid,
    );
    created.push(target.credential);
    writeNew(
      target.environment,
      Object.entries(payload.environment)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
      0,
      0,
    );
    created.push(target.environment);
  } catch (error) {
    for (const path of created.reverse()) rmSync(path, { force: true });
    if (createdDirectory) rmSync(providerDirectory, { recursive: true });
    throw error;
  }
  process.stdout.write(
    '{"status":"production-glossary-provisioned-inert","filesCreated":3,"valuesPrinted":0,"providerRequests":0,"unitsStarted":0}\n',
  );
}

function replaceConfig() {
  if (
    !existsSync('/etc/chalkwright/production/server.json') ||
    Object.values(target).some((path) => !existsSync(path))
  )
    throw new Error('production-glossary-replace-target-invalid');
  assertProtectedTarget(target.config, serviceAccount.uid, serviceAccount.gid);
  assertProtectedTarget(
    target.credential,
    serviceAccount.uid,
    serviceAccount.gid,
  );
  assertProtectedTarget(target.environment, 0, 0);
  const config = buildProductionGlossaryConfig(
    JSON.parse(readProtectedSource(source.config)),
  );
  writeReplacement(
    target.config,
    `${JSON.stringify(config, null, 2)}\n`,
    serviceAccount.uid,
    serviceAccount.gid,
  );
  process.stdout.write(
    '{"status":"production-glossary-config-replaced","filesReplaced":1,"credentialsChanged":0,"valuesPrinted":0,"providerRequests":0,"unitsStarted":0}\n',
  );
}

function assertConfig(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('production-glossary-provision-config-invalid');
  if (
    Object.keys(value).sort().join(',') !==
      'academicYear,academicYearFolderId,courses,maximumFilesPerCourse,maximumPagesPerSource,requestTimeoutSeconds,version' ||
    value.version !== 1 ||
    typeof value.academicYear !== 'string' ||
    !/^\d{4}-\d{2}$/.test(value.academicYear) ||
    typeof value.academicYearFolderId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,256}$/.test(value.academicYearFolderId) ||
    !Number.isInteger(value.requestTimeoutSeconds) ||
    value.requestTimeoutSeconds < 1 ||
    value.requestTimeoutSeconds > 60 ||
    !Number.isInteger(value.maximumPagesPerSource) ||
    value.maximumPagesPerSource < 1 ||
    value.maximumPagesPerSource > 10 ||
    !Number.isInteger(value.maximumFilesPerCourse) ||
    value.maximumFilesPerCourse < 1 ||
    value.maximumFilesPerCourse > 50 ||
    !Array.isArray(value.courses) ||
    value.courses.length < 1 ||
    value.courses.length > 24
  )
    throw new Error('production-glossary-provision-config-invalid');
  const classIds = new Set();
  for (const item of value.courses) {
    if (
      item === null ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (key) =>
          ![
            'classId',
            'className',
            'courseName',
            'defaultLanguage',
            'glossaryFolderPath',
            'subject',
          ].includes(key),
      ) ||
      typeof item.classId !== 'string' ||
      classIds.has(item.classId) ||
      typeof item.subject !== 'string' ||
      typeof item.courseName !== 'string' ||
      typeof item.defaultLanguage !== 'string' ||
      (item.className !== undefined && typeof item.className !== 'string')
    )
      throw new Error('production-glossary-provision-config-invalid');
    if (
      item.glossaryFolderPath !== undefined &&
      (!Array.isArray(item.glossaryFolderPath) ||
        item.glossaryFolderPath.length < 1 ||
        item.glossaryFolderPath.length > 4 ||
        item.glossaryFolderPath.some(
          (segment) =>
            typeof segment !== 'string' ||
            segment.length < 1 ||
            segment.length > 256 ||
            /[\r\n\0]/u.test(segment),
        ))
    )
      throw new Error('production-glossary-provision-config-invalid');
    classIds.add(item.classId);
  }
}

function assertCredential(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'clientId,clientSecret,refreshToken,scopes,type,version' ||
    value.version !== 1 ||
    value.type !== 'authorized-user' ||
    typeof value.clientId !== 'string' ||
    typeof value.clientSecret !== 'string' ||
    typeof value.refreshToken !== 'string' ||
    !Array.isArray(value.scopes) ||
    value.scopes.length !== 1 ||
    value.scopes[0] !== driveScope
  )
    throw new Error('production-glossary-provision-credential-invalid');
}

function readProtectedSource(path) {
  const before = lstatSync(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    (before.mode & 0o077) !== 0 ||
    before.size < 2 ||
    before.size > 128 * 1024 ||
    realpathSync(path) !== path
  )
    throw new Error('production-glossary-provision-source-unsafe');
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error('production-glossary-provision-source-unsafe');
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

function writeNew(path, bytes, uid, gid) {
  const descriptor = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes, 'utf8');
    fchmodSync(descriptor, 0o600);
    fchownSync(descriptor, uid, gid);
  } finally {
    closeSync(descriptor);
  }
}

function assertProtectedTarget(path, uid, gid) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== uid ||
    stat.gid !== gid ||
    realpathSync(path) !== path
  )
    throw new Error('production-glossary-replace-target-unsafe');
}

function writeReplacement(path, bytes, uid, gid) {
  const candidate = `${path}.candidate-${process.pid}`;
  let descriptor;
  try {
    descriptor = openSync(
      candidate,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, bytes, 'utf8');
    fchmodSync(descriptor, 0o600);
    fchownSync(descriptor, uid, gid);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(candidate, path);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(candidate, { force: true });
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z0-9-]{3,96}$/.test(error.message)
        ? error.message
        : 'production-glossary-provision-failed';
    process.stderr.write(`{"status":"rejected","code":"${code}"}\n`);
    process.exitCode = 1;
  }
}
