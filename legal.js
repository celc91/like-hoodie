/* ==========================================================================
   like hoodie ♡ — aviso de cookies y preferencias
   --------------------------------------------------------------------------
   Tres caminos: aceptar todo, solo lo esencial, o configurar por separado
   analítica y publicidad. La elección se puede cambiar desde cookies.html.
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

  function save(state) {
    if (consent) consent.set(state);
    removeNotice();
  }

  function panelHTML() {
    const current = (consent && consent.get()) || { analytics: false, ads: false };
    return (
      '<div class="consent-panel">' +
      "<p><strong>Elige qué permites.</strong></p>" +
      '<label class="consent-option">' +
      '<input type="checkbox" data-consent-toggle="analytics"' +
      (current.analytics ? " checked" : "") +
      ">" +
      "<span><strong>Analítica</strong><small>Google Analytics: qué páginas y pasos se usan.</small></span>" +
      "</label>" +
      '<label class="consent-option">' +
      '<input type="checkbox" data-consent-toggle="ads"' +
      (current.ads ? " checked" : "") +
      ">" +
      "<span><strong>Publicidad</strong><small>Meta Pixel: medir campañas en Facebook e Instagram.</small></span>" +
      "</label>" +
      '<div class="cookie-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-consent-action="cancel">Cancelar</button>' +
      '<button type="button" class="btn btn-lime btn-sm" data-consent-action="save">Guardar</button>' +
      "</div>" +
      "</div>"
    );
  }

  function buildNotice() {
    if (notice) return;

    notice = document.createElement("aside");
    notice.className = "cookie-notice";
    notice.setAttribute("role", "region");
    notice.setAttribute("aria-label", "Preferencias de cookies");
    notice.innerHTML =
      '<div class="consent-main">' +
      "<p><strong>Cookies y medición.</strong> Usamos almacenamiento esencial para tu carrito. " +
      "Con tu permiso, cargamos analítica y, si lo aceptas, publicidad para medir campañas. " +
      'Puedes cambiarlo en <a href="cookies.html">Cookies</a>.</p>' +
      '<div class="cookie-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-consent-action="essential">Solo esenciales</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-consent-action="config">Configurar</button>' +
      '<button type="button" class="btn btn-lime btn-sm" data-consent-action="all">Aceptar todo</button>' +
      "</div>" +
      "</div>";

    document.body.appendChild(notice);
    window.requestAnimationFrame(function () {
      notice.classList.add("is-visible");
    });

    notice.addEventListener("click", function (event) {
      const button = event.target.closest("[data-consent-action]");
      if (!button) return;
      const action = button.getAttribute("data-consent-action");

      if (action === "all") return save({ analytics: true, ads: true });
      if (action === "essential") return save({ analytics: false, ads: false });
      if (action === "config") {
        notice.innerHTML = panelHTML();
        notice.classList.add("is-configuring");
        return;
      }
      if (action === "cancel") {
        removeNotice();
        return;
      }
      if (action === "save") {
        const analytics = notice.querySelector('[data-consent-toggle="analytics"]');
        const ads = notice.querySelector('[data-consent-toggle="ads"]');
        return save({
          analytics: Boolean(analytics && analytics.checked),
          ads: Boolean(ads && ads.checked),
        });
      }
    });
  }

  document.addEventListener("likehoodie:consent-open", buildNotice);

  if (!consent || !consent.get()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", buildNotice);
    } else {
      buildNotice();
    }
  }
})();
