// Self-contained secret detector (no external binary).
//
// `findSecrets(text)` returns an array of { line, rule, preview } for content that
// looks like a committed secret. It is deliberately conservative — tuned to catch
// the high-signal cases (PEM private keys, cloud access keys, high-entropy values
// assigned to secret-named identifiers) while NOT flagging descriptive,
// low-entropy synthetic fixtures such as `test-secret-not-a-real-credential`.
//
// Allowlist: any line containing the marker `pragma: allowlist secret` is skipped,
// so an intentional synthetic fixture can opt out explicitly.
//
// IMPORTANT: this module must never embed a real credential. All patterns are
// structural; tests use synthetic inputs only.

export const ALLOW_MARKER = 'pragma: allowlist secret';

// Shannon entropy in bits per character — a cheap "does this look random?" signal.
export function shannonEntropy(str) {
  if (!str) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let bits = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// A value "looks random" (vs. a dictionary-ish phrase) when it is long, high
// entropy, and either mixes character classes or is a long hex/base64 token.
// Descriptive fixtures (all-lowercase words joined by dashes) fail this on purpose.
function looksRandom(value) {
  if (value.length < 20) return false;
  if (shannonEntropy(value) < 3.5) return false;
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasDigit = /[0-9]/.test(value);
  const mixedClasses = hasLower && hasUpper && hasDigit;
  const longHex = /^[A-Fa-f0-9]{32,}$/.test(value);
  const base64ish = /^[A-Za-z0-9+/]{24,}={0,2}$/.test(value) && hasDigit && (hasUpper || hasLower);
  return mixedClasses || longHex || base64ish;
}

const SECRET_NAME = '(?:client[_-]?secret|secret|api[_-]?key|apikey|access[_-]?key|token|password|passwd|pwd)';
// identifier <assign> "value" — captures the value (quoted or bare). The optional
// quote before the separator lets it match quoted object / JSON keys too, e.g.
// `"client_secret": "<value>"` (the closing quote precedes the colon).
const ASSIGN_RE = new RegExp(
  `${SECRET_NAME}['"\`]?\\s*[:=]\\s*['"\`]?([^\\s'"\`]{20,})['"\`]?`,
  'i'
);
// Any standard PEM private-key header, including ENCRYPTED / RSA / EC / OPENSSH /
// DSA / PGP and the bare `PRIVATE KEY`. `[A-Z0-9 ]*` covers the optional label.
const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const AWS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/;

export function findSecrets(text) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return; // explicit opt-out
    const lineNo = i + 1;

    if (PEM_RE.test(line)) {
      findings.push({ line: lineNo, rule: 'private-key', preview: 'BEGIN … PRIVATE KEY' });
      return;
    }
    const aws = line.match(AWS_KEY_RE);
    if (aws) {
      findings.push({ line: lineNo, rule: 'aws-access-key', preview: redact(aws[0]) });
      return;
    }
    const assign = line.match(ASSIGN_RE);
    if (assign && looksRandom(assign[1])) {
      findings.push({ line: lineNo, rule: 'assigned-secret', preview: redact(assign[1]) });
    }
  });
  return findings;
}

// Never echo a candidate secret in full — show only a short, masked preview.
function redact(value) {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}…${value.slice(-2)} (${value.length} chars)`;
}
