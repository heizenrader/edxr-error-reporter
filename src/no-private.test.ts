// This package is public. Nothing private may be in it. The rules are generic
// (this file names nothing internal): no key-shaped strings, no private-key
// blocks, no local-network names, and only one public host of ours. It scans
// the source, the README, package.json and the build output.
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const root = join(__dirname, "..");

const files = (dir: string): string[] =>
  !existsSync(dir)
    ? []
    : readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? files(p) : [p];
      });

const scanned = [
  ...files(join(root, "src")).filter((f) => !f.endsWith("no-private.test.ts")),
  ...files(join(root, "dist")),
  join(root, "README.md"),
  join(root, "package.json"),
].filter(existsSync);

const KEY_SHAPES: RegExp[] = [
  /\b[sprk]{2}_(?:live|test)_[A-Za-z0-9]{8,}/, // payment-style keys
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // a JWT
  /\b[0-9a-f]{32,}\b/i, // long hex
  /\bAKIA[0-9A-Z]{16}\b/, // cloud access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // github tokens
  /\bxox[abpsr]-[A-Za-z0-9-]{10,}/, // slack tokens
  /BEGIN [A-Z ]*PRIVATE KEY/,
];
// Long base64-looking runs are flagged only when they mix digits and both cases.
const LONG_MIXED = /[A-Za-z0-9+/]{40,}={0,2}/g;

const ALLOWED_HOSTS = new Set([
  "api.educationxr.com", // the one public default endpoint
  "github.com",
  "localhost",
  "example.org",
  "example.net",
  "example.com",
  "a.example.org",
  "b.example.org",
  "x.example.org",
  "cdn.example.net",
  "www.w3.org", // namespaces some bundles carry
  "reactjs.org",
  "react.dev",
  "nodejs.org",
]);
const PUBLIC_HOST = "api.educationxr.com";

const show = (f: string, bad: unknown) => ({ file: relative(root, f), bad });

test("there is something to scan", () => {
  expect(scanned.some((f) => f.startsWith(join(root, "src")))).toBe(true);
  expect(scanned.some((f) => f.startsWith(join(root, "dist")))).toBe(true);
  expect(scanned.some((f) => f.endsWith("README.md"))).toBe(true);
});

test("no key-shaped strings", () => {
  for (const f of scanned) {
    const text = readFileSync(f, "utf8");
    const bad: string[] = [];
    for (const re of KEY_SHAPES) bad.push(...(text.match(new RegExp(re.source, re.flags.replace("g", "") + "g")) || []));
    bad.push(...(text.match(LONG_MIXED) || []).filter((s) => /[0-9]/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s)));
    expect(show(f, bad)).toEqual(show(f, []));
  }
});

test("no local-network names", () => {
  for (const f of scanned) {
    const hit = /\.(?:local|internal|lan|corp|intranet)\b(?!\w)/i.test(readFileSync(f, "utf8").replace(/\.(?:local)Storage/g, ""));
    expect(show(f, hit)).toEqual(show(f, false));
  }
});

test("every URL host is public and on the list", () => {
  for (const f of scanned) {
    const hosts = [...readFileSync(f, "utf8").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    expect(show(f, hosts.filter((h) => !ALLOWED_HOSTS.has(h)))).toEqual(show(f, []));
  }
});

test("our own domain appears only as the one public host", () => {
  for (const f of scanned) {
    const names = (readFileSync(f, "utf8").toLowerCase().match(/[a-z0-9.-]*educationxr\.[a-z]+/g) || []).filter((h) => h !== PUBLIC_HOST);
    expect(show(f, names)).toEqual(show(f, []));
  }
});

test("no ticket or issue references", () => {
  for (const f of scanned) {
    const text = readFileSync(f, "utf8");
    const bad = [...(text.match(/issues?\s*#\d+|\/issues\/\d+|\/pull\/\d+/gi) || [])];
    expect(show(f, bad)).toEqual(show(f, []));
  }
});
