import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const [mode, marker] = process.argv.slice(2);
if (mode === 'success') {
  await new Promise((resolve, reject) => {
    process.send?.('{"status":"synthetic-success"}', (error) =>
      error === null ? resolve() : reject(error),
    );
  });
} else if (mode === 'hang') {
  setInterval(() => undefined, 60_000);
} else if (mode === 'term-exit') {
  process.once('SIGTERM', () => process.exit(0));
  setInterval(() => undefined, 60_000);
} else if (mode === 'descendant' && marker !== undefined) {
  const descendant = spawn(
    process.execPath,
    ['--eval', 'setInterval(() => undefined, 60_000)'],
    { stdio: 'ignore' },
  );
  await writeFile(marker, String(descendant.pid), { encoding: 'utf8' });
  setInterval(() => undefined, 60_000);
} else if (mode === 'stdin') {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  for (const chunk of chunks) chunk.fill(0);
  await new Promise((resolve, reject) => {
    process.send?.(
      JSON.stringify({ status: 'stdin-received', total }),
      (error) => (error === null ? resolve() : reject(error)),
    );
  });
} else {
  process.exitCode = 2;
}
