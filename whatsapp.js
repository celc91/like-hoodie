(function () {
  "use strict";

  const config = window.LIKEHOODIE_WHATSAPP;
  if (!config || !config.number) return;

  const number = String(config.number).replace(/\D/g, "");
  if (number.length < 10) return;

  const context = String(document.body.dataset.waContext || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

  const message = context
    ? `${config.message} Me interesa ${context}.`
    : config.message;

  const href = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;

  document.querySelectorAll("[data-whatsapp-link]").forEach((link) => {
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });

  if (document.querySelector(".wa-float")) return;

  const link = document.createElement("a");
  link.className = "wa-float";
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", "Escríbenos por WhatsApp");
  link.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.2 4.4 4.5-1.18A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-2.67.7.72-2.6-.2-.32a8.2 8.2 0 1 1 6.63 3.55Zm4.5-6.14c-.25-.12-1.46-.72-1.68-.8-.23-.08-.4-.12-.56.12-.17.25-.65.8-.8.97-.14.16-.29.18-.54.06-.25-.12-1.04-.38-1.98-1.22-.73-.65-1.22-1.46-1.37-1.7-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.07-.12-.56-1.34-.77-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.23.9 2.42 1.02 2.59.13.16 1.77 2.7 4.3 3.79.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.07.14-1.18-.06-.1-.23-.16-.48-.28Z"/>
    </svg>
    <span class="wa-float__label" aria-hidden="true">WhatsApp</span>
  `;
  document.body.appendChild(link);
})();
