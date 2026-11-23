import { act } from "react";
import { createRoot } from "react-dom/client";
import { _resetForTests, init } from "./index";
import { ErrorBoundary } from "./react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  delete (global as any).fetch;
  _resetForTests();
});

const Bomb = () => {
  throw new Error("render crash");
};

test("a render crash shows the fallback and is reported with its component stack", async () => {
  const calls: any[] = [];
  (global as any).fetch = jest.fn((_u: string, i: any) => {
    calls.push(JSON.parse(i.body));
    return Promise.resolve({ status: 204 });
  });
  init({ app: "website", key: "k" });
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  const el = document.createElement("div");
  await act(async () => {
    createRoot(el).render(
      <ErrorBoundary fallback={(e) => <p>failed: {e.message}</p>}>
        <Bomb />
      </ErrorBoundary>,
    );
  });
  spy.mockRestore();
  expect(el.textContent).toBe("failed: render crash");
  expect(calls).toHaveLength(1);
  expect(calls[0].componentStack).toContain("Bomb");
});
