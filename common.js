// Small shared helpers across games/pages

// Simple online/offline indicator (optional)
(function () {
  const el = document.getElementById("pwaStatus");
  if (!el) return;

  const update = () => {
    el.textContent = navigator.onLine ? "Online" : "Offline";
  };
  update();
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
})();

// Service Worker registration (PWA/offline + faster updates)
(function () {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

      // Proactively check for updates on each load (works best with /sw.js no-store header)
      try { await reg.update(); } catch {}

      // If a new SW takes control, reload once to pick up new cached assets
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });

      // If there's already a waiting SW, ask it to activate now
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            sw.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    } catch {
      // ignore
    }
  });
})();
