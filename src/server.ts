import { DEFAULT_ENDPOINT } from "./index";
import { LIMITS, cap, pagePath, scrubURLs } from "./scrub";

export interface ServerReportOptions {
  app: string;
  key: string;
  release?: string;
  route?: string;
  endpoint?: string;
}

/** Reports an error caught on a server (a route handler, a render). Never throws. */
export async function reportServerError(error: unknown, opts: ServerReportOptions): Promise<void> {
  try {
    const e = (error && typeof error === "object" ? error : { message: String(error) }) as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
    };
    const body = {
      kind: "server",
      app: opts.app,
      release: opts.release,
      // The route goes through the same scrub as a browser page: ids and
      // tokens in its segments are replaced. `path` is what the server stores as the page.
      route: opts.route ? pagePath(opts.route) : undefined,
      path: opts.route ? pagePath(opts.route) : undefined,
      name: cap(typeof e.name === "string" && e.name ? e.name : "Error", LIMITS.name),
      message: cap(scrubURLs(typeof e.message === "string" ? e.message : String(error)), LIMITS.message),
      stack: cap(scrubURLs(typeof e.stack === "string" ? e.stack : ""), LIMITS.stack),
    };
    await fetch(opts.endpoint || DEFAULT_ENDPOINT, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json", "Edxr-Report-Key": opts.key },
      body: JSON.stringify(body),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(5000) : undefined,
    });
  } catch {
    // never throws
  }
}
