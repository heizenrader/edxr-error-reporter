# edxr-error-reporter

Browser and server error reporting for EducationXR websites. Errors go to
EducationXR's error tracking through the public API gateway.

Install, pinned to a commit:

```json
"edxr-error-reporter": "github:heizenrader/edxr-error-reporter#<commit-sha>"
```

## Browser

```ts
import { init } from "edxr-error-reporter";

init({
  app: "website",            // the app name your key is registered for
  key: "<your report key>",  // from the EducationXR staff; optional (see below)
  release: "1.4.0",          // optional
  getToken: () => null,      // optional: a signed-in person's token
  getRequestId: () => null,  // optional: the id of the last failed API call
  sampleLimit: 10,           // optional: most reports per page load
  headers: () => ({}),       // optional: extra headers for every fetch request
});
```

API:

- `init(options)`: starts reporting. `key` is optional: without it no `Edxr-Report-Key` header and no `key` body field are sent (the server decides which apps it accepts without one). `headers()` is merged into every fetch request, never the beacon (which cannot carry headers); it can never override `Content-Type`, `Edxr-Report-Key` or `Authorization`.
- `report(error, { componentStack })`: `Promise<string | null>`. Resolves with the server's request id (from the `x-request-id` response header, when it has the shape of an id), the reference support can look up, or `null` (nothing sent, a beacon, a failed send, a duplicate, noise, over the sample limit). Never throws. Automatic window reports ignore it.
- `stop()`: ends sending and removes the listeners; nothing is sent until `init` is called again.

`init` listens for uncaught errors and unhandled rejections (only `Error`
rejections count). `report(error, { componentStack })` sends one by hand.

React render crashes:

```tsx
import { ErrorBoundary } from "edxr-error-reporter/react";

<ErrorBoundary fallback={(error) => <p>Something went wrong.</p>}>
  <App />
</ErrorBoundary>
```

React is an optional peer dependency: only `edxr-error-reporter/react` needs it.

## Server

```ts
import { reportServerError } from "edxr-error-reporter/server";

await reportServerError(error, { app: "website", key: process.env.REPORT_KEY!, route: "/api/courses/123" });
```

A server report is sent with `kind: "server"` (a browser one with `kind: "client"`), `release`, and the route as `path`, scrubbed like a browser page (`/api/courses/:n`).

## What it does

- Sends to `https://api.educationxr.com/api/ddd/errors/client` (override with `endpoint`).
- The key travels in the `Edxr-Report-Key` header; a beacon fallback carries `key` and `app` in its body as `text/plain`.
- No cookies on fetch (`credentials: "omit"`). The beacon fallback cannot omit credentials (browsers always include them on `sendBeacon`); it is used only when fetch itself fails. A token is sent as `Authorization` only when `getToken` returns one.
- Sends go one at a time. After the first refused or failed send of any kind, nothing more is sent for that page load.
- Types resolve under both `moduleResolution: "node"` (via `typesVersions`) and `bundler`/`node16`.
- A send that has not answered in 10 seconds counts as failed. When the page is hidden or unloaded (`pagehide`, `visibilitychange` to hidden), reports still waiting in the queue are sent by beacon, once each.
- Each distinct error is sent once per page load, at most `sampleLimit` (default 10).
- Nothing leaves with a query string: URLs in messages and stacks lose their query and fragment, and the page is sent as a path with ids and tokens replaced.
- Never reported: ResizeObserver warnings, `Script error.`, extension and other-origin scripts, aborted requests, chunk-load failures after a release, and API failures that already carry a request id.
- Reporting never throws.

## Development

```
npm install
npm test     # builds, then runs the tests, including the check that nothing private is in the package
```
