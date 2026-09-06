function argumentText(argument) {
  if (typeof argument?.value === "string") return argument.value;
  if (argument?.value !== undefined) return String(argument.value);
  return typeof argument?.description === "string" ? argument.description : "";
}

function sameOrigin(url, baseOrigin) {
  try { return new URL(url).origin === baseOrigin; }
  catch { return false; }
}

/**
 * @param {unknown[]} events
 * @param {{ baseOrigin: string, loaderId?: string | null }} options
 */
export function collectRouteDiagnostics(events, { baseOrigin, loaderId = null }) {
  const diagnostics = [];
  const seen = new Set();
  const routeExecutionContexts = new Set(events.flatMap((event) => {
    if (event?.method !== "Runtime.executionContextCreated") return [];
    const context = event.params?.context;
    return Number.isInteger(context?.id) && context?.origin === baseOrigin ? [context.id] : [];
  }));
  const belongsToRouteContext = (contextId) => !Number.isInteger(contextId) || routeExecutionContexts.has(contextId);
  const push = (diagnostic) => {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push(diagnostic);
  };

  for (const event of events) {
    if (event?.method === "Network.responseReceived") {
      const response = event.params?.response;
      const belongsToRouteLoader = !loaderId || !event.params?.loaderId || event.params.loaderId === loaderId;
      if (belongsToRouteLoader && Number(response?.status) >= 400 && sameOrigin(response?.url, baseOrigin)) {
        push({ kind: "http", status: Number(response.status), url: response.url });
      }
      continue;
    }

    if (event?.method === "Runtime.exceptionThrown") {
      const details = event.params?.exceptionDetails;
      if (!belongsToRouteContext(details?.executionContextId)) continue;
      push({
        kind: "exception",
        text: details?.exception?.description || details?.text || "Unhandled browser exception",
        url: details?.url || null,
      });
      continue;
    }

    if (event?.method === "Runtime.consoleAPICalled" && event.params?.type === "error") {
      if (!belongsToRouteContext(event.params?.executionContextId)) continue;
      push({
        kind: "console",
        text: (event.params.args || []).map(argumentText).filter(Boolean).join(" ") || "Browser console error",
        url: null,
      });
      continue;
    }

    if (event?.method === "Log.entryAdded" && event.params?.entry?.level === "error") {
      const entry = event.params.entry;
      if (entry.url && !sameOrigin(entry.url, baseOrigin)) continue;
      push({ kind: "log", text: entry.text || "Browser log error", url: entry.url || null });
    }
  }

  return diagnostics;
}
