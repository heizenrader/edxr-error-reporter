import { reportServerError } from "./server";

afterEach(() => {
  delete (global as any).fetch;
});

test("sends kind server with the key header and no credentials", async () => {
  const calls: any[] = [];
  (global as any).fetch = jest.fn((url: string, init: any) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return Promise.resolve({ status: 204 });
  });
  const e = new Error("db down at https://x.example.org/p?token=abc");
  await reportServerError(e, { app: "website", key: "k", release: "9", route: "/api/users/123?y=1" });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://api.educationxr.com/v1/errors/reports");
  expect(calls[0].init.headers["Edxr-Report-Key"]).toBe("k");
  expect(calls[0].init.credentials).toBe("omit");
  expect(calls[0].body).toMatchObject({ kind: "server", app: "website", release: "9", route: "/api/users/:n", path: "/api/users/:n", name: "Error" });
  expect(calls[0].body.message).toBe("db down at https://x.example.org/p");
});

test("never throws, even when fetch does", async () => {
  (global as any).fetch = jest.fn(() => Promise.reject(new Error("down")));
  await expect(reportServerError("plain string", { app: "docs", key: "k" })).resolves.toBeUndefined();
});

test("the route is scrubbed like a browser path: ids and tokens are replaced", async () => {
  const bodies: any[] = [];
  (global as any).fetch = jest.fn((_u: string, i: any) => {
    bodies.push(JSON.parse(i.body));
    return Promise.resolve({ status: 204 });
  });
  await reportServerError(new Error("x"), { app: "website", key: "k", route: "/reset/Zk3xq9TT0aa1bbYYccDD?t=1" });
  expect(bodies[0].path).toBe("/reset/:token");
  expect(bodies[0].route).toBe("/reset/:token");
});
