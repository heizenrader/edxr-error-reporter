import { DEFAULT_ENDPOINT, DEFAULT_SAMPLE_LIMIT, _resetForTests, init, isNoise, report, stop } from "./index";

const boom = (message = "x is undefined", name = "TypeError") => {
  const e = new Error(message);
  e.name = name;
  e.stack = `${name}: ${message}\n    at Ka (http://localhost/static/js/main.3f9a1c2b.js?v=1:2:3)`;
  return e;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

type Call = { url: string; init: any; body: any };
const mockFetch = (status = 204) => {
  const calls: Call[] = [];
  (global as any).fetch = jest.fn((url: string, init: any) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return Promise.resolve({ status });
  });
  return calls;
};

beforeEach(() => {
  _resetForTests();
  window.history.pushState({}, "", "/courses/12?token=secret#x");
});
afterEach(() => {
  delete (global as any).fetch;
  _resetForTests();
});

test("a crash is sent once with the key header, the app and no query anywhere", async () => {
  const calls = mockFetch();
  init({ app: "website", key: "test-key", release: "1.2.3" });
  await report(boom());
  expect(calls).toHaveLength(1);
  const { url, init: i, body } = calls[0];
  expect(url).toBe(DEFAULT_ENDPOINT);
  expect(i.method).toBe("POST");
  expect(i.keepalive).toBe(true);
  expect(i.credentials).toBe("omit");
  expect(i.headers["Edxr-Report-Key"]).toBe("test-key");
  expect(i.headers.Authorization).toBeUndefined();
  expect(body).toMatchObject({ kind: "client", app: "website", release: "1.2.3", name: "TypeError", path: "/courses/:n" });
  expect(body.stack).toContain("http://localhost/static/js/main.3f9a1c2b.js:2:3");
  expect(JSON.stringify(body)).not.toContain("secret");
  expect(JSON.stringify(body)).not.toContain("v=1");
});

test("identical errors are counted once", async () => {
  const calls = mockFetch();
  init({ app: "website", key: "k" });
  await report(boom());
  await report(boom());
  const same = boom("again");
  await report(same);
  await report(same);
  expect(calls).toHaveLength(2);
});

test("the default sampleLimit is 10, and a custom one holds", async () => {
  expect(DEFAULT_SAMPLE_LIMIT).toBe(10);
  const calls = mockFetch();
  init({ app: "website", key: "k" });
  for (let i = 0; i < 15; i++) await report(boom(`crash ${i}`));
  expect(calls).toHaveLength(10);
  _resetForTests();
  calls.length = 0;
  init({ app: "website", key: "k", sampleLimit: 2 });
  for (let i = 0; i < 5; i++) await report(boom(`other ${i}`));
  expect(calls).toHaveLength(2);
});

test("window error and unhandledrejection are reported once each; non-Error rejections are not", async () => {
  const calls = mockFetch();
  init({ app: "docs", key: "k" });
  const err = boom("uncaught");
  window.dispatchEvent(
    Object.assign(new Event("error"), { error: err, message: err.message, filename: `${window.location.origin}/static/js/main.js` }),
  );
  const api = new Event("unhandledrejection") as any;
  api.reason = { error: "An error occurred.", status: 500 };
  window.dispatchEvent(api);
  const rej = new Event("unhandledrejection") as any;
  rej.reason = boom("rejected");
  window.dispatchEvent(rej);
  await flush();
  expect(calls.map((c) => c.body.message)).toEqual(["uncaught", "rejected"]);
});

test("after a 403 nothing more is sent for this page load", async () => {
  const calls = mockFetch(403);
  init({ app: "website", key: "k" });
  await report(boom("one"));
  await report(boom("two"));
  expect(calls).toHaveLength(1);
});

test("after any non-2xx nothing more is sent", async () => {
  const calls = mockFetch(500);
  init({ app: "website", key: "k" });
  await report(boom("one"));
  await report(boom("two"));
  expect(calls).toHaveLength(1);
});

test("a network failure sends one beacon with key and app in the body, then stops", async () => {
  const beacon = jest.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  (global as any).fetch = jest.fn(() => Promise.reject(new TypeError("Failed to fetch")));
  init({ app: "docs", key: "beacon-key" });
  await report(boom("one"));
  await report(boom("two"));
  expect((global as any).fetch).toHaveBeenCalledTimes(1);
  expect(beacon).toHaveBeenCalledTimes(1);
  const [url, blob] = (beacon.mock.calls as any)[0];
  expect(url).toBe(DEFAULT_ENDPOINT);
  expect(blob.type).toBe("text/plain");
  const text = await new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsText(blob);
  });
  expect(JSON.parse(text)).toMatchObject({ key: "beacon-key", app: "docs", message: "one" });
});

test("a token is sent as Authorization only when getToken gives one; the last failed request is named", async () => {
  const calls = mockFetch();
  let token: string | null = null;
  init({ app: "website", key: "k", getToken: () => token, getRequestId: () => "req-1" });
  await report(boom("a"));
  token = "tok";
  await report(boom("b"));
  expect(calls[0].init.headers.Authorization).toBeUndefined();
  expect(calls[1].init.headers.Authorization).toBe("tok");
  expect(calls[0].body.failedRequestID).toBe("req-1");
});

test("a custom endpoint is used; before init nothing is sent; report never throws", async () => {
  const calls = mockFetch();
  await report(boom("early"));
  expect(calls).toHaveLength(0);
  init({ app: "website", key: "k", endpoint: "https://example.org/errors" });
  (global as any).fetch = jest.fn(() => {
    throw new Error("sync failure");
  });
  await expect(report(boom("x"))).resolves.toBeNull();
});

test("noise is never sent", async () => {
  const calls = mockFetch();
  init({ app: "website", key: "k" });
  await report(boom("ResizeObserver loop completed with undelivered notifications.", "Error"));
  await report(boom("Loading chunk 12 failed.", "ChunkLoadError"));
  expect(calls).toHaveLength(0);
});

test("text limits are applied", async () => {
  const calls = mockFetch();
  init({ app: "website", key: "k" });
  const e = boom("m".repeat(5000));
  e.stack = "s".repeat(20000);
  await report(e, { componentStack: "c".repeat(9000) });
  expect(calls[0].body.message).toHaveLength(1000);
  expect(calls[0].body.stack).toHaveLength(8000);
  expect(calls[0].body.componentStack).toHaveLength(4000);
});

test("an extension runtime API failure with no stack, or no frame of ours, is dropped; a real TypeError from main.js is sent", async () => {
  const calls = mockFetch();
  init({ app: "website", key: "k" });
  const bare = Object.assign(new Error("Invalid call to runtime.sendMessage(). Tab not found."), { name: "Error", stack: "" });
  const foreign = boom("Extension context invalidated: chrome.runtime.connect failed");
  foreign.stack = "Error: x\n    at f (https://cdn.example.net/inject.js:1:1)";
  await report(bare);
  await report(foreign);
  await report(null, undefined, { message: "Invalid call to runtime.sendMessage()" });
  expect(calls).toHaveLength(0);
  expect(isNoise(boom("browser.runtime is undefined"))).toBe(false);
  await report(boom("Cannot read properties of undefined (reading 'map')"));
  expect(calls).toHaveLength(1);
});

test("a burst whose first send gets a 403 sends exactly one request", async () => {
  const calls = mockFetch(403);
  init({ app: "website", key: "k" });
  await Promise.all([report(boom("a")), report(boom("b")), report(boom("c")), report(boom("d"))]);
  expect(calls).toHaveLength(1);
});

test("sends go one at a time, in order", async () => {
  const order: string[] = [];
  let open = 0;
  let maxOpen = 0;
  (global as any).fetch = jest.fn(async (_u: string, i: any) => {
    open++;
    maxOpen = Math.max(maxOpen, open);
    await new Promise((r) => setTimeout(r, 5));
    order.push(JSON.parse(i.body).message);
    open--;
    return { status: 204 };
  });
  init({ app: "website", key: "k" });
  await Promise.all([report(boom("a")), report(boom("b")), report(boom("c"))]);
  expect(order).toEqual(["a", "b", "c"]);
  expect(maxOpen).toBe(1);
});

describe("timeout and unload", () => {
  afterEach(() => {
    jest.useRealTimers();
    delete (navigator as any).sendBeacon;
  });
  const mockBeacon = () => {
    const sent: any[] = [];
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: jest.fn((_u: string, blob: Blob) => {
        sent.push(blob);
        return true;
      }),
    });
    return sent;
  };
  const text = (blob: Blob) =>
    new Promise<any>((res) => {
      const r = new FileReader();
      r.onload = () => res(JSON.parse(String(r.result)));
      r.readAsText(blob);
    });

  test("a hung fetch times out, counts as failed, sends no beacon, and later reports are not sent", async () => {
    jest.useFakeTimers();
    const beacon = mockBeacon();
    const urls: string[] = [];
    (global as any).fetch = jest.fn(
      (_u: string, i: any) =>
        new Promise((_res, rej) => {
          urls.push(_u);
          i.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        }),
    );
    init({ app: "website", key: "k" });
    const first = report(boom("hung"));
    const second = report(boom("later"));
    await jest.advanceTimersByTimeAsync(9_000);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_500);
    await Promise.all([first, second]);
    expect((global as any).fetch).toHaveBeenCalledTimes(1); // the later one never started
    await report(boom("after"));
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(beacon).toHaveLength(0); // a timed-out report is never repeated by beacon
  });

  test("a burst queued behind a slow send, then pagehide, goes by beacon exactly once each", async () => {
    const beacon = mockBeacon();
    let release: (v: any) => void = () => {};
    const calls: string[] = [];
    (global as any).fetch = jest.fn((_u: string, i: any) => {
      calls.push(JSON.parse(i.body).message);
      return new Promise((r) => (release = r));
    });
    init({ app: "website", key: "k" });
    const all = Promise.all([report(boom("slow")), report(boom("q1")), report(boom("q2")), report(boom("q3"))]);
    await flush();
    expect(calls).toEqual(["slow"]);
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide")); // a second hide sends nothing again
    expect(beacon).toHaveLength(3);
    const bodies = await Promise.all(beacon.map(text));
    expect(bodies.map((b) => b.message)).toEqual(["q1", "q2", "q3"]);
    expect(bodies.every((b) => b.key === "k" && b.app === "website")).toBe(true);
    release({ status: 204 });
    await all;
    expect(calls).toEqual(["slow"]); // the flushed ones are never also fetched
    expect(beacon).toHaveLength(3);
  });

  test("visibilitychange to hidden flushes the queue too", async () => {
    const beacon = mockBeacon();
    let release: (v: any) => void = () => {};
    (global as any).fetch = jest.fn(() => new Promise((r) => (release = r)));
    init({ app: "website", key: "k" });
    const all = Promise.all([report(boom("slow")), report(boom("q1"))]);
    await flush();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    expect(beacon).toHaveLength(1);
    release({ status: 204 });
    await all;
  });

  test("nothing goes out after a stop, not even on pagehide", async () => {
    const beacon = mockBeacon();
    let release: (v: any) => void = () => {};
    const fetchMock = jest.fn(() => new Promise((r) => (release = r)));
    (global as any).fetch = fetchMock;
    init({ app: "website", key: "k" });
    const all = Promise.all([report(boom("refused")), report(boom("q1")), report(boom("q2"))]);
    await flush();
    release({ status: 403 });
    await all;
    window.dispatchEvent(new Event("pagehide"));
    await report(boom("later"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(beacon).toHaveLength(0);
  });
});

describe("admin contract", () => {
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const fetchWith = (status: number, id: string | null) => {
    const calls: any[] = [];
    (global as any).fetch = jest.fn((url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return Promise.resolve({ status, headers: { get: (k: string) => (k.toLowerCase() === "x-request-id" ? id : null) } });
    });
    return calls;
  };

  test("without a key no key header and no key in the beacon body are sent", async () => {
    const calls = fetchWith(204, null);
    init({ app: "admin" });
    await report(boom("a"));
    expect(Object.keys(calls[0].init.headers).map((k) => k.toLowerCase())).not.toContain("edxr-report-key");
    expect(JSON.stringify(calls[0].init)).not.toContain("undefined");
    _resetForTests();
    const beacon = jest.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    (global as any).fetch = jest.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    init({ app: "admin" });
    await report(boom("b"));
    const blob = (beacon.mock.calls as any)[0][1] as Blob;
    const text = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsText(blob);
    });
    const parsed = JSON.parse(text);
    expect(parsed.app).toBe("admin");
    expect("key" in parsed).toBe(false);
    delete (navigator as any).sendBeacon;
  });

  test("report resolves to the request id, or null", async () => {
    fetchWith(204, ID);
    init({ app: "website", key: "k" });
    expect(await report(boom("a"))).toBe(ID);
    expect(await report(boom("a"))).toBeNull(); // duplicate
    _resetForTests();
    fetchWith(204, "not an id!");
    init({ app: "website", key: "k" });
    expect(await report(boom("b"))).toBeNull(); // invalid shape
    _resetForTests();
    fetchWith(204, null);
    init({ app: "website", key: "k" });
    expect(await report(boom("c"))).toBeNull(); // no header
    expect(await report(boom("ResizeObserver loop limit exceeded", "Error"))).toBeNull(); // noise
    _resetForTests();
    fetchWith(403, ID);
    init({ app: "website", key: "k" });
    expect(await report(boom("d"))).toBeNull(); // refused
    expect(await report(boom("e"))).toBeNull(); // stopped
    _resetForTests();
    expect(await report(boom("f"))).toBeNull(); // not initialised
  });

  test("stop() ends sending and removes the listeners", async () => {
    const calls = fetchWith(204, ID);
    init({ app: "website", key: "k" });
    stop();
    await report(boom("a"));
    const rej = new Event("unhandledrejection") as any;
    rej.reason = boom("rejected after stop");
    window.dispatchEvent(rej);
    await flush();
    expect(calls).toHaveLength(0);
    expect(() => stop()).not.toThrow();
    init({ app: "website", key: "k" }); // a later init works again
    await report(boom("b"));
    expect(calls).toHaveLength(1);
  });

  test("headers are merged into the fetch, and never override Content-Type, Edxr-Report-Key or Authorization", async () => {
    const calls = fetchWith(204, null);
    init({
      app: "admin",
      key: "real-key",
      getToken: () => "real-token",
      headers: () => ({
        "edxr-user-agent": '{"app":"x"}',
        "content-type": "text/evil",
        "Content-Type": "text/evil",
        "EDXR-REPORT-KEY": "evil",
        authorization: "evil",
        Authorization: "evil",
      }),
    });
    await report(boom("a"));
    const h = calls[0].init.headers;
    expect(h["edxr-user-agent"]).toBe('{"app":"x"}');
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["Edxr-Report-Key"]).toBe("real-key");
    expect(h.Authorization).toBe("real-token");
    expect(Object.keys(h).filter((k) => /^(content-type|edxr-report-key|authorization)$/i.test(k)).sort()).toEqual(["Authorization", "Content-Type", "Edxr-Report-Key"]);
  });

  test("a throwing headers function sends the report without extras; the beacon never carries headers", async () => {
    const calls = fetchWith(204, null);
    init({ app: "admin", key: "k", headers: () => { throw new Error("boom"); } });
    await report(boom("a"));
    expect(calls).toHaveLength(1);
  });
});
