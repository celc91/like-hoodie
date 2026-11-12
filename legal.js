/* ==========================================================================
   like hoodie ♡ — Aviso de cookies y preferencias
   --------------------------------------------------------------------------
   Dos opciones: aceptar analítica o quedarse solo con lo esencial.
   La elección se guarda y se puede cambiar desde cookies.html.
   ========================================================================== */

(function () {
  "use strict";

  const consent = window.LikeHoodieConsent;
  let notice = null;

  function removeNotice() {
    if (!notice) return;
    notice.classList.remove("is-visible");
    const el = notice;
    notice = null;
    window.setTimeout(function () {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }

  function buildNotice() {
    if (notice) return;

    notice = document.createElement("aside");
    notice.className = "cookie-notice";
    notice.setAttribute("role", "region");
    notice.setAttribute("aria-label", "Preferencias de cookies");
    notice.innerHTML =
      '<p><strong>Cookies y analítica.</strong> Usamos almacenamiento esencial para tu carrito. ' +
      "Si lo aceptas, cargamos Google Analytics para saber qué funciona en la tienda. " +
      'Puedes decirlo después en <a href="cookies.html">Cookies</a>.</p>' +
      '<div class="cookie-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-consent="denied">Solo esenciales</button>' +
      '<button type="button" class="btn btn-lime btn-sm" data-consent="granted">Aceptar analítica</button>' +
      "</div>";

    document.body.appendChild(notice);
    window.requestAnimationFrame(function () {
      notice.classList.add("is-visible");
    });

    notice.addEventListener("click", function (event) {
      const button = event.target.closest("[data-consent]");
      if (!button) return;
      if (consent) consent.set(button.getAttribute("data-consent"));
      removeNotice();
    });
  }

  // abre el aviso desde cualquier página (botón "cambiar preferencias")
  document.addEventListener("likehoodie:consent-open", buildNotice);

  // si aún no hay decisión, se muestra
  if (!consent || !consent.get()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", buildNotice);
    } else {
      buildNotice();
    }
  }
})();
