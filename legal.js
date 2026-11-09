/* ==========================================================================
   Chama — Aviso de cookies y almacenamiento local
   ========================================================================== */

(function () {
  "use strict";

  const STORAGE_KEY = "chama_cookie_notice_v1";

  function wasAccepted() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "accepted";
    } catch (error) {
      return false;
    }
  }

  function rememberAcceptance() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "accepted");
    } catch (error) {
      /* Si el navegador bloquea el almacenamiento, el aviso se ocultará
         solo durante esta visita. */
    }
  }

  function buildNotice() {
    const notice = document.createElement("aside");
    notice.className = "cookie-notice";
    notice.setAttribute("role", "region");
    notice.setAttribute("aria-label", "Aviso de cookies y almacenamiento local");
    notice.innerHTML =
      '<p><strong>Cookies y almacenamiento local.</strong> Usamos almacenamiento esencial para guardar tu carrito. No usamos cookies de publicidad. <a href="cookies.html">Más información</a>.</p>' +
      '<button type="button" class="btn btn-lime btn-sm">Entendido</button>';

    document.body.appendChild(notice);
    window.requestAnimationFrame(() => notice.classList.add("is-visible"));

    const button = notice.querySelector("button");
    if (button) {
      button.addEventListener("click", () => {
        rememberAcceptance();
        notice.classList.remove("is-visible");
        window.setTimeout(() => notice.remove(), 300);
      });
    }
  }

  if (!wasAccepted()) {
    buildNotice();
  }
})();
