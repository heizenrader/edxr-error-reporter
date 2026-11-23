// What leaves the browser: URLs lose their query and fragment, the page is a
// path with ids and tokens replaced, every text is capped, and known noise is
// never sent.

export const LIMITS = { name: 64, message: 1000, stack: 8000, componentStack: 4000 };

export const cap = (s: unknown, n: number): string =>
  typeof s === "string" ? (s.length > n ? s.slice(0, n) : s) : "";

const EXTENSION = /^(?:chrome|moz|safari|safari-web|ms-browser)-extension:/i;
const EXTENSION_ANYWHERE = /(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;

const originOf = (url: string): string | null => {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return null;
  }
};

/** URLs in s lose their query and fragment; a trailing :line:col stays. */
export const scrubURLs = (s: unknown): string =>
  cap(s, 64 * 1024).replace(/[a-z][a-z0-9+.-]*:\/\/[^\s()]+/gi, (u) => {
    const pos = (u.match(/(?::\d+){1,2}$/) || [""])[0];
    const bare = pos ? u.slice(0, -pos.length) : u;
    const cut = bare.search(/[?#]/);
    return (cut >= 0 ? bare.slice(0, cut) : bare) + pos;
  });

/** The page, as reported: the path only, each segment that may be an id or a secret replaced. */
export const pagePath = (pathname: unknown): string => {
  const path = typeof pathname === "string" ? pathname.split(/[?#]/)[0] : "";
  const out = path
    .split("/")
    .map((s) => {
      if (s === "" || /^[a-z]+(?:[-_.][a-z]+)*$/.test(s)) return s;
      if (/^\d+$/.test(s)) return ":n";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return ":uuid";
      if (s.length >= 16 || /\d/.test(s) || /[%=+~]/.test(s)) return ":token";
      return s;
    })
    .join("/");
  return cap(out || "/", 512);
};

export interface ErrorLike {
  name?: string;
  message: string;
  stack?: string;
  code?: unknown;
  isAxiosError?: unknown;
  requestID?: unknown;
}

export const errorLike = (v: unknown): v is ErrorLike =>
  !!v &&
  typeof v === "object" &&
  typeof (v as ErrorLike).message === "string" &&
  (typeof (v as ErrorLike).name === "string" || v instanceof Error);

// webpack's "Loading chunk 12 failed.", and the browsers' words for a dynamic
// import that no longer exists (after a release the old chunks are gone).
const CHUNK_LOAD =
  /Loading (CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

// A browser extension's own API failing ("Invalid call to
// runtime.sendMessage()", Mobile Safari especially), named in the message.
const EXTENSION_API = /\b(?:runtime\.sendMessage|runtime\.connect|browser\.runtime|chrome\.runtime)\b/i;

// Whether a stack has no frame from this origin (an empty stack has none).
const noFrameFromHere = (stack: unknown): boolean => {
  const urls = (typeof stack === "string" ? stack : "").match(/[a-z][a-z0-9+.-]*:\/\/[^\s()]+/gi) || [];
  return !urls.some((u) => originOf(u.replace(/(?::\d+){1,2}$/, "")) === window.location.origin);
};

/** Whether an error (or what an error event says of it) is noise that is never sent. */
export const isNoise = (
  error: ErrorLike | null | undefined,
  event: { message?: string; filename?: string } = {},
): boolean => {
  const message = String((error && error.message) || event.message || "");
  if (/ResizeObserver loop/i.test(message)) return true;
  if (EXTENSION_API.test(message) && noFrameFromHere(error ? error.stack : "")) return true;
  if (CHUNK_LOAD.test(message) || (error && error.name === "ChunkLoadError")) return true;
  // A cross-origin script's error is "Script error." with nothing else.
  if (!error && /^Script error\.?$/i.test(message.trim())) return true;
  const file = event.filename || "";
  if (file && (EXTENSION.test(file) || originOf(file) !== window.location.origin)) return true;
  if (error) {
    if (error.name === "AbortError" || error.name === "CanceledError" || error.code === "ERR_CANCELED") return true;
    if (error.isAxiosError) return true;
    // An API failure that carries a request id is already in the request log.
    // (The original rule asks its own request-id helper; here the id is a plain `requestID` string property.)
    if (typeof error.requestID === "string" && error.requestID) return true;
    if (typeof error.stack === "string" && EXTENSION_ANYWHERE.test(error.stack)) return true;
  }
  return false;
};

export const firstFrame = (stack: unknown): string => {
  const lines = (typeof stack === "string" ? stack : "").split("\n").map((l) => l.trim());
  return lines.find((l) => /^at\s|@/.test(l)) || "";
};
