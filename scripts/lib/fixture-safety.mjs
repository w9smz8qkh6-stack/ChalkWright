import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const rules = [
  {
    id: 'private-key',
    pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i,
  },
  {
    id: 'secret-assignment',
    pattern:
      /\b(?:client_secret|refresh_token|access_token|api_key|password)\s*[:=]\s*["']?[^\s"'<{][^\s"']*/i,
  },
  {
    id: 'provider-token',
    pattern: /\b(?:sk-[a-z0-9]{20,}|ya29\.[a-z0-9_-]+)/i,
  },
  {
    id: 'oauth-client-id',
    pattern: /\b[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com\b/i,
  },
  {
    id: 'email-or-calendar-address',
    pattern: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
  },
  {
    id: 'absolute-url',
    pattern: /\bhttps?:\/\/[^\s"')]+/i,
  },
  {
    id: 'private-host-or-address',
    pattern:
      /(?:\b(?:localhost|[a-z0-9-]+\.(?:local|internal|ts\.net))\b|\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b)/i,
  },
  {
    id: 'live-uuid',
    pattern:
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  },
  {
    id: 'long-numeric-identifier',
    pattern: /\b\d{15,}\b/,
  },
  {
    id: 'long-provider-identifier',
    pattern:
      /\b(?:calendarId|courseId|formId|spreadsheetId|presentationId)\s*[:=]\s*["']?[a-z0-9_-]{16,}/i,
  },
  {
    id: 'student-record-field',
    pattern:
      /\b(?:student(?:Id|Name|Email)|firstName|lastName|roster|scoresheet|gradeAverage)\b/,
  },
  {
    id: 'credential-or-capture-field',
    pattern:
      /\b(?:cookie|authorizationHeader|oauthToken|browserProfile|rawHtml|rawCapture)\b/i,
  },
  {
    id: 'unsafe-absolute-path',
    pattern: /(?:^|[="'`\s])\/(?:home|srv|etc|var|opt|Users)\//,
  },
];

export function inspectFixtureText(text, source = '<text>') {
  // Reserved fixture.example.invalid URLs exercise link fields without naming
  // a routable or organization-owned host.
  const inspectedText = text.replace(
    /https:\/\/fixture\.example\.invalid(?=\/|[?#\s"'`)\]}]|$)(?:[/?#][^\s"'`)\]}]*)?/gi,
    'synthetic-fixture-url',
  );
  return rules.flatMap((rule) => {
    const match = inspectedText.match(rule.pattern);

    return match
      ? [
          {
            ruleId: rule.id,
            source,
            offset: match.index ?? 0,
          },
        ]
      : [];
  });
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return filesUnder(path);
    }

    return entry.isFile() && ['.ts', '.json'].includes(extname(path))
      ? [path]
      : [];
  });
}

export function scanFixtureDirectory(directory) {
  return filesUnder(directory).flatMap((path) =>
    inspectFixtureText(readFileSync(path, 'utf8'), path),
  );
}
