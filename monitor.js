(function () {
  "use strict";

  const config = window.LIKEHOODIE_SUPABASE;
  if (!config || !config.url || !config.publishableKey) return;

  const MAX_REPORTS = 5;
  const endpoint = `${config.url.replace(/\/+$/, "")}/functions/v1/client-error`;
  const seen = new Set();
  let sent = 0;

  function report(message, source, stack) {
    if (sent >= MAX_REPORTS) return;
    const text = String(message || "").trim();
    if (!text || /Script error\.?/i.test(text)) return;
    if (/ResizeObserver loop/i.test(text)) return;
    const key = text.slice(0, 140);
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;
    try {
      fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${config.publishableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          source,
          stack,
          path: window.location.pathname,
          userAgent: navigator.userAgent,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch (error) {
      /* la monitorización nunca debe romper la página */
    }
  }

  window.addEventListener("error", (event) => {
    const source = event.filename || "";
    if (source && !source.startsWith(window.location.origin)) return;
    report(event.message || "Error de script", source, event.error && event.error.stack);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    report(
      reason && reason.message ? reason.message : String(reason || "Promesa rechazada"),
      "",
      reason && reason.stack
    );
  });
})();
