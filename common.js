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
