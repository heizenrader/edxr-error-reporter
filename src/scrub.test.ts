import { isNoise, pagePath, scrubURLs } from "./scrub";

const boom = (message = "x is undefined", name = "TypeError") => {
  const e = new Error(message);
  e.name = name;
  e.stack = `${name}: ${message}\n    at Ka (http://localhost/static/js/main.3f9a1c2b.js?v=1:2:3)`;
  return e;
};

test("pagePath replaces ids and token-like segments", () => {
  expect(pagePath("/courses/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("/courses/:uuid");
  expect(pagePath("/invite/Zk3xq9TT0aa1bbYYccDD")).toBe("/invite/:token");
  expect(pagePath("/courses/5/lessons")).toBe("/courses/:n/lessons");
  expect(pagePath("")).toBe("/");
});

test("scrubURLs drops queries and fragments, keeps :line:col", () => {
  expect(scrubURLs("at f (https://a.example.org/x.js?k=secret:2:3) and https://b.example.org/p#frag")).toBe(
    "at f (https://a.example.org/x.js:2:3) and https://b.example.org/p",
  );
});

test("noise is recognised", () => {
  const axiosErr: any = boom("Request failed with status code 500", "AxiosError");
  axiosErr.isAxiosError = true;
  const tagged: any = Object.assign(boom("conflict", "Error"), { requestID: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  const ext = boom("ext");
  ext.stack = "Error: ext\n    at x (chrome-extension://abc/content.js:1:1)";
  const cases: Array<[Error | null, { message?: string; filename?: string }]> = [
    [boom("ResizeObserver loop completed with undelivered notifications.", "Error"), {}],
    [null, { message: "Script error." }],
    [boom("aborted", "AbortError"), {}],
    [boom("canceled", "CanceledError"), {}],
    [axiosErr, {}],
    [tagged, {}],
    [ext, {}],
    [boom("other origin"), { filename: "https://cdn.example.net/lib.js" }],
    [boom("extension"), { filename: "moz-extension://x/y.js" }],
    [boom("Loading chunk 12 failed.\n(error: https://a.example.org/static/js/12.chunk.js)", "ChunkLoadError"), {}],
    [boom("Loading CSS chunk 3 failed.", "Error"), {}],
    [boom("Failed to fetch dynamically imported module: https://a.example.org/x.js", "TypeError"), {}],
  ];
  for (const [err, ev] of cases) expect(isNoise(err, ev)).toBe(true);
  expect(isNoise(boom("real"), { filename: `${window.location.origin}/static/js/main.js` })).toBe(false);
});
