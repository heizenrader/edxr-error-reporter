import { LIMITS, cap, errorLike, firstFrame, isNoise, pagePath, scrubURLs, type ErrorLike } from "./scrub";

export { scrubURLs, pagePath, isNoise } from "./scrub";

export const DEFAULT_ENDPOINT = "https://api.educationxr.com/api/ddd/errors/client";
export const DEFAULT_SAMPLE_LIMIT = 10;
/** A send that has not answered by then counts as failed. */
export const FETCH_TIMEOUT_MS = 10_000;

export interface InitOptions {
  /** The app name the server knows you by. */
  app: string;
  /** Your report key. Leave it out for an app the server accepts without one: no key header or body field is sent then. */
  key?: string;
  release?: string;
  endpoint?: string;
  /** Returns a signed-in person's token, or null. Sent as the Authorization header. */
  getToken?: () => string | null;
  /** Returns the id of the last failed API call, or null. */
  getRequestId?: () => string | null;
  /** Extra headers for every fetch request (never the beacon, which cannot carry headers). Content-Type, Edxr-Report-Key and Authorization are never overridden. */
  headers?: () => Record<string, string>;
  /** Most reports per page load. Default 10. */
  sampleLimit?: number;
}

interface Job {
  body: ReportBody;
  state: "queued" | "started" | "flushed";
}

interface State {
  cfg: Required<Pick<InitOptions, "app" | "endpoint" | "sampleLimit">> & InitOptions;
  sent: number;
  stopped: boolean;
  keys: Set<string>;
  objects: WeakSet<object>;
  pageLoadID: string;
  chain: Promise<void>;
  /** Reports queued or being sent; a queued one is flushed by beacon on unload. */
  pending: Job[];
  stop?: () => void;
}

let state: State | null = null;

const newPageLoadID = (): string => {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Starts reporting: listens for uncaught errors and unhandled rejections. Call once, in the browser. */
export function init(options: InitOptions): void {
  if (typeof window === "undefined") return;
  if (state && state.stop) state.stop();
  const next: State = {
    cfg: {
      ...options,
      endpoint: options.endpoint || DEFAULT_ENDPOINT,
      sampleLimit: options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT,
    },
    sent: 0,
    stopped: false,
    keys: new Set(),
    objects: new WeakSet(),
    pageLoadID: newPageLoadID(),
    chain: Promise.resolve(),
    pending: [],
  };
  const onError = (e: ErrorEvent) => {
    void report(e.error, undefined, { message: e.message, filename: e.filename });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    // Only an Error is a crash; other rejections are the app's own answers.
    if (!errorLike(e.reason)) return;
    void report(e.reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  // Reports still waiting in the queue when the page goes away are sent by
  // beacon, once each; one already in flight stays with its keepalive fetch.
  const onHide = () => flush(next);
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") flush(next);
  };
  window.addEventListener("pagehide", onHide);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  next.stop = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("pagehide", onHide);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };
  state = next;
}

/** Ends sending and removes the listeners. Nothing is sent afterwards, until `init` is called again. */
export function stop(): void {
  if (state) {
    state.stopped = true;
    if (state.stop) state.stop();
    state.stop = undefined;
  }
}

/** Forgets this page load's state and stops listening (tests). */
export function _resetForTests(): void {
  if (state && state.stop) state.stop();
  state = null;
}

type ReportBody = ReturnType<typeof buildReport>;

const buildReport = (s: State, err: ErrorLike, componentStack?: string) => {
  let failed: string | null = null;
  try {
    failed = s.cfg.getRequestId ? s.cfg.getRequestId() : null;
  } catch {
    failed = null;
  }
  return {
    kind: "client",
    app: s.cfg.app,
    release: s.cfg.release,
    name: cap(typeof err.name === "string" && err.name ? err.name : "Error", LIMITS.name),
    message: cap(scrubURLs(err.message || ""), LIMITS.message),
    stack: cap(scrubURLs(typeof err.stack === "string" ? err.stack : ""), LIMITS.stack),
    componentStack: cap(scrubURLs(componentStack || ""), LIMITS.componentStack),
    path: pagePath(window.location.pathname),
    failedRequestID: failed || undefined,
    pageLoadID: s.pageLoadID,
  };
};

// After the first refused or failed send of any kind, nothing more is sent
// for this page load.
const beacon = (s: State, body: ReportBody): void => {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // text/plain keeps the beacon a simple request (no preflight); it
      // cannot carry headers, so the key and app ride in the body.
      navigator.sendBeacon(s.cfg.endpoint, new Blob([JSON.stringify(s.cfg.key ? { ...body, key: s.cfg.key } : body)], { type: "text/plain" }));
    }
  } catch {
    // nothing more to try
  }
};

// Sends every report that has not started by beacon and clears them from the
// queue. Nothing goes out once sending has stopped.
const flush = (s: State): void => {
  if (s.stopped) return;
  for (const job of s.pending) {
    if (job.state !== "queued") continue;
    job.state = "flushed";
    beacon(s, job.body);
  }
  s.pending = s.pending.filter((j) => j.state === "started");
};

// A request id as the server mints it (a UUID); anything else is not returned.
const REQUEST_ID = /^[0-9a-fA-F-]{8,64}$/;
const idOf = (res: unknown): string | null => {
  try {
    const h = (res as { headers?: { get?: (k: string) => string | null } } | null)?.headers;
    const v = h && typeof h.get === "function" ? h.get("x-request-id") : null;
    return typeof v === "string" && REQUEST_ID.test(v) ? v : null;
  } catch {
    return null;
  }
};

const FIXED_HEADERS = new Set(["content-type", "edxr-report-key", "authorization"]);

const send = async (s: State, body: ReportBody): Promise<string | null> => {
  const json = JSON.stringify(body);
  if (typeof fetch === "function") {
    const headers: Record<string, string> = {};
    try {
      const extra = s.cfg.headers ? s.cfg.headers() : null;
      if (extra && typeof extra === "object") {
        for (const [k, v] of Object.entries(extra)) {
          if (!FIXED_HEADERS.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;
        }
      }
    } catch {
      // no extra headers
    }
    headers["Content-Type"] = "application/json";
    if (s.cfg.key) headers["Edxr-Report-Key"] = s.cfg.key;
    try {
      const token = s.cfg.getToken ? s.cfg.getToken() : null;
      if (token) headers.Authorization = token;
    } catch {
      // anonymous
    }
    // A hung request must not block every later report: it times out, and a
    // timeout counts as a failed send.
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    let timedOut = false;
    const timer = ctl
      ? setTimeout(() => {
          timedOut = true;
          ctl.abort();
        }, FETCH_TIMEOUT_MS)
      : undefined;
    try {
      const res = await fetch(s.cfg.endpoint, {
        method: "POST",
        keepalive: true,
        credentials: "omit",
        headers,
        body: json,
        signal: ctl ? ctl.signal : undefined,
      });
      if (!res || res.status < 200 || res.status >= 300) {
        s.stopped = true;
        return null;
      }
      return idOf(res);
    } catch {
      // a browser that refuses this request, or a network or CORS failure:
      // one beacon for this report, then nothing more.
      s.stopped = true;
      // The request may already have reached the server: a timed-out send is
      // never repeated by beacon (a duplicate would inflate the count).
      if (timedOut) return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  beacon(s, body);
  s.stopped = true;
  return null;
};

/**
 * Reports one error. Never throws. Noise, repeats, the per-page cap and a stopped reporter send nothing.
 * Resolves with the server's request id (the reference support can look up), or null when there is none:
 * nothing was sent, a beacon was used, or the send failed.
 */
export async function report(
  error: unknown,
  extra?: { componentStack?: string },
  event?: { message?: string; filename?: string },
): Promise<string | null> {
  try {
    const s = state;
    if (!s || s.stopped || s.sent >= s.cfg.sampleLimit) return null;
    let err: ErrorLike;
    if (errorLike(error)) err = error;
    else if (typeof error === "string") err = { name: "Error", message: error };
    else if (event && event.message) err = { name: "Error", message: String(event.message) };
    else return null;
    if (isNoise(errorLike(error) ? error : null, event || {})) return null;
    if (typeof error === "object" && error !== null) {
      if (s.objects.has(error)) return null;
      s.objects.add(error);
    }
    const key = `${err.name}|${err.message}|${firstFrame(err.stack)}`;
    if (s.keys.has(key)) return null;
    s.keys.add(key);
    s.sent++;
    const body = buildReport(s, err, extra?.componentStack);
    // Sends go one at a time: the first refused or failed send stops every
    // later one, even in a burst.
    let id: string | null = null;
    const item: Job = { body, state: "queued" };
    s.pending.push(item);
    const job = s.chain
      .then(() => {
        if (item.state !== "queued" || s.stopped) return undefined; // flushed on unload, or stopped
        item.state = "started";
        return send(s, body).then((v) => {
          id = v;
        });
      })
      .catch(() => undefined)
      .then(() => {
        s.pending = s.pending.filter((j) => j !== item);
      });
    s.chain = job;
    await job;
    return id;
  } catch {
    return null;
  }
}
