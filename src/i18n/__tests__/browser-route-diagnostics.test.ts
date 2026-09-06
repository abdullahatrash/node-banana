import { describe, expect, it } from "vitest";
import { collectRouteDiagnostics } from "../../../scripts/browser-route-diagnostics.mjs";

describe("visual-smoke browser route diagnostics", () => {
  it("reports same-origin failed resources while ignoring external provider failures", () => {
    const diagnostics = collectRouteDiagnostics([
      { method: "Network.responseReceived", params: { response: { status: 503, url: "http://localhost:3002/api/status" } } },
      { method: "Network.responseReceived", params: { response: { status: 404, url: "http://localhost:3002/api/media/missing" } } },
      { method: "Network.responseReceived", params: { response: { status: 503, url: "https://provider.example/status" } } },
    ], { baseOrigin: "http://localhost:3002" });

    expect(diagnostics).toEqual([
      { kind: "http", status: 503, url: "http://localhost:3002/api/status" },
      { kind: "http", status: 404, url: "http://localhost:3002/api/media/missing" },
    ]);
  });

  it("reports browser exceptions and error-level console or log entries", () => {
    const diagnostics = collectRouteDiagnostics([
      { method: "Runtime.consoleAPICalled", params: { type: "warning", args: [{ value: "not fatal" }] } },
      { method: "Runtime.consoleAPICalled", params: { type: "error", args: [{ value: "render failed" }, { value: 17 }] } },
      { method: "Runtime.exceptionThrown", params: { exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: broken" }, url: "http://localhost:3002/dashboard" } } },
      { method: "Log.entryAdded", params: { entry: { level: "error", text: "Hydration failed", url: "http://localhost:3002/dashboard" } } },
      { method: "Log.entryAdded", params: { entry: { level: "error", text: "Provider rejected", url: "https://provider.example/resource" } } },
    ], { baseOrigin: "http://localhost:3002" });

    expect(diagnostics).toEqual([
      { kind: "console", text: "render failed 17", url: null },
      { kind: "exception", text: "TypeError: broken", url: "http://localhost:3002/dashboard" },
      { kind: "log", text: "Hydration failed", url: "http://localhost:3002/dashboard" },
    ]);
  });

  it("attributes diagnostics to the captured loader and execution context", () => {
    const diagnostics = collectRouteDiagnostics([
      { method: "Runtime.executionContextCreated", params: { context: { id: 22, origin: "http://localhost:3002" } } },
      { method: "Runtime.consoleAPICalled", params: { type: "error", executionContextId: 11, args: [{ value: "late previous route" }] } },
      { method: "Runtime.consoleAPICalled", params: { type: "error", executionContextId: 22, args: [{ value: "current route" }] } },
      { method: "Runtime.exceptionThrown", params: { exceptionDetails: { executionContextId: 11, text: "old exception" } } },
      { method: "Runtime.exceptionThrown", params: { exceptionDetails: { executionContextId: 22, text: "new exception" } } },
      { method: "Network.responseReceived", params: { loaderId: "old", response: { status: 503, url: "http://localhost:3002/api/old" } } },
      { method: "Network.responseReceived", params: { loaderId: "current", response: { status: 500, url: "http://localhost:3002/api/current" } } },
    ], { baseOrigin: "http://localhost:3002", loaderId: "current" });

    expect(diagnostics).toEqual([
      { kind: "console", text: "current route", url: null },
      { kind: "exception", text: "new exception", url: null },
      { kind: "http", status: 500, url: "http://localhost:3002/api/current" },
    ]);
  });
});
