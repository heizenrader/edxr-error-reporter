// Loads the BUILT package (run `npm run build` first; `npm test` does) in
// node, as an ES module and as CommonJS, through the exports map.
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = join(__dirname, "..");

const PRELUDE = `
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  location: { pathname: "/courses/12", href: "http://localhost/courses/12", origin: "http://localhost" },
};
const calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { status: 204 }; };
`;

const CHECK = `
const boundary = new react.ErrorBoundary({});
const err = new Error("render crash");
err.stack = "Error: render crash\\n    at Foo (http://localhost/main.js:1:1)";
boundary.componentDidCatch(err, { componentStack: "\\n    at Foo" });
await core.report(new Error("second"));
await server.reportServerError(new Error("srv"), { app: "docs", key: "k", route: "/api/items/9" });
const out = {
  inits: typeof core.init, boundary: typeof react.ErrorBoundary, server: typeof server.reportServerError,
  kinds: calls.map((c) => c.body.kind + ":" + c.body.message),
  keyed: calls.every((c) => c.init.headers["Edxr-Report-Key"]),
  componentStack: calls[0] && calls[0].body.componentStack,
  serverPath: calls[2] && calls[2].body.path,
};
console.log(JSON.stringify(out));
`;

const run = (args: string[], file: string, code: string) => {
  const dir = mkdtempSync(join(tmpdir(), "edxr-dist-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(root, join(dir, "node_modules", "edxr-error-reporter"), "dir");
  symlinkSync(join(root, "node_modules", "react"), join(dir, "node_modules", "react"), "dir");
  writeFileSync(join(dir, file), code);
  const r = spawnSync(process.execPath, [...args, join(dir, file)], { cwd: dir, encoding: "utf8" });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout.trim().split("\n").pop() as string);
};

const expected = {
  inits: "function",
  boundary: "function",
  server: "function",
  // init through the built core, then the built boundary and the built core's report share it
  kinds: ["client:render crash", "client:second", "server:srv"],
  keyed: true,
  componentStack: expect.stringContaining("Foo"),
  serverPath: "/api/items/:n",
};

beforeAll(() => {
  expect(existsSync(join(root, "dist", "react.js"))).toBe(true);
});

test("the built ESM entries load by their subpaths and share state", () => {
  const out = run(
    [],
    "check.mjs",
    `${PRELUDE}
import * as core from "edxr-error-reporter";
import * as react from "edxr-error-reporter/react";
import * as server from "edxr-error-reporter/server";
core.init({ app: "website", key: "k" });
${CHECK}`,
  );
  expect(out).toMatchObject(expected);
});

test("the built CJS entries load by their subpaths and share state", () => {
  const out = run(
    [],
    "check.cjs",
    `${PRELUDE}
(async () => {
const core = require("edxr-error-reporter");
const react = require("edxr-error-reporter/react");
const server = require("edxr-error-reporter/server");
core.init({ app: "website", key: "k" });
${CHECK}
})().catch((e) => { console.error(e); process.exit(1); });`,
  );
  expect(out).toMatchObject(expected);
});

test("the types of every entry resolve under moduleResolution node", () => {
  const dir = mkdtempSync(join(tmpdir(), "edxr-types-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(root, join(dir, "node_modules", "edxr-error-reporter"), "dir");
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { module: "commonjs", moduleResolution: "node", strict: true, noEmit: true, skipLibCheck: true, jsx: "react-jsx", typeRoots: [join(root, "node_modules", "@types")], types: [] },
      files: ["check.tsx"],
    }),
  );
  writeFileSync(
    join(dir, "check.tsx"),
    `import { init, report, stop } from "edxr-error-reporter";
import { ErrorBoundary } from "edxr-error-reporter/react";
import { reportServerError } from "edxr-error-reporter/server";
init({ app: "website", key: "k" });
export const a: Promise<string | null> = report(new Error("x"));
stop();
init({ app: "admin", headers: () => ({ "x-a": "b" }) });
export const b: Promise<void> = reportServerError(new Error("x"), { app: "docs", key: "k", route: "/x" });
export const c = ErrorBoundary;
`,
  );
  const r = spawnSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", dir], { cwd: dir, encoding: "utf8" });
  expect(r.stdout).toBe("");
  expect(r.status).toBe(0);
});
