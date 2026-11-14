(function () {
  "use strict";

  const config = window.LIKEHOODIE_SUPABASE;
  const form = document.querySelector("[data-track-form]");
  const result = document.querySelector("[data-track-result]");
  const errorBox = document.querySelector("[data-track-error]");
  const submit = document.querySelector("[data-track-submit]");
  if (!form || !result || !errorBox || !submit) return;

  const STATUS = {
    pending: {
      label: "Recibido",
      step: 0,
      note: "Estamos confirmando tu pedido. Te avisaremos cuando entre a producción.",
    },
    confirmed: {
      label: "Confirmado",
      step: 1,
      note: "Tu pedido está confirmado y entra a producción.",
    },
    production: {
      label: "En producción",
      step: 2,
      note: "Estamos imprimiendo y preparando tu sudadera.",
    },
    shipped: {
      label: "Enviado",
      step: 3,
      note: "Tu pedido ya salió del taller. Revisa la guía si está disponible.",
    },
    delivered: {
      label: "Entregado",
      step: 4,
      note: "Tu pedido llegó a su destino. Gracias por confiar en like hoodie.",
    },
    cancelled: {
      label: "Cancelado",
      step: -1,
      note: "Este pedido fue cancelado. Escríbenos si necesitas más información.",
    },
  };

  const STEPS = ["Recibido", "Confirmado", "Producción", "Enviado", "Entregado"];

  const escapeHTML = (value) =>
    String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const formatMoney = (value) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);

  const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
  };

  function setError(message) {
    if (!message) {
      errorBox.hidden = true;
      errorBox.textContent = "";
      return;
    }
    errorBox.hidden = false;
    errorBox.textContent = message;
  }

  function setBusy(busy) {
    submit.disabled = busy;
    submit.textContent = busy ? "Buscando…" : "Buscar pedido";
    form.setAttribute("aria-busy", String(busy));
  }

  function parseOrderNumber(value) {
    const match = String(value || "").trim().match(/^(?:LH-?)?\s*(\d{1,9})$/i);
    return match ? Number(match[1]) : null;
  }

  function trackingBlock(order) {
    if (order.tracking_url && /^https:\/\//i.test(order.tracking_url)) {
      return `<div class="track-tracking">
        <p><strong>${escapeHTML(order.carrier || "Paquetería")}</strong>${order.tracking_number ? ` · Guía ${escapeHTML(order.tracking_number)}` : ""}</p>
        <a class="btn btn-dark" href="${escapeHTML(order.tracking_url)}" target="_blank" rel="noopener noreferrer">Seguir mi envío</a>
      </div>`;
    }
    if (order.tracking_number) {
      return `<div class="track-tracking">
        <p><strong>${escapeHTML(order.carrier || "Paquetería")}</strong> · Guía <span class="track-guide">${escapeHTML(order.tracking_number)}</span></p>
        <p class="track-muted">La paquetería aún no tiene una página de seguimiento pública.</p>
      </div>`;
    }
    return `<p class="track-muted">Todavía no hay guía. Te avisaremos cuando el pedido salga del taller.</p>`;
  }

  function render(order) {
    const status = STATUS[order.status] || {
      label: order.status || "En proceso",
      step: 0,
      note: "",
    };
    const items = Array.isArray(order.items) ? order.items : [];
    const steps = STEPS.map((label, index) => {
      const done = status.step >= index && status.step >= 0;
      const current = status.step === index;
      return `<li class="${done ? "is-done" : ""}${current ? " is-current" : ""}">
        <span class="track-dot" aria-hidden="true"></span>
        <span>${label}</span>
      </li>`;
    }).join("");

    result.innerHTML = `
      <div class="track-result__head">
        <span class="track-status track-status--${escapeHTML(order.status || "pending")}">${escapeHTML(status.label)}</span>
        <span class="track-number">Pedido <strong>LH-${escapeHTML(order.number)}</strong></span>
      </div>
      <p class="track-note">${escapeHTML(status.note)}</p>
      <ol class="track-steps" aria-label="Progreso del pedido">${steps}</ol>
      <p class="track-muted">Pedido del ${escapeHTML(formatDate(order.created_at))}${
        order.updated_at && order.updated_at !== order.created_at
          ? ` · Actualizado ${escapeHTML(formatDate(order.updated_at))}`
          : ""
      }</p>
      <div class="track-items">
        <h3>Tu pedido</h3>
        <ul>
          ${items
            .map(
              (item) => `<li>
              <span>${escapeHTML(item.qty)}× ${escapeHTML(item.name)}</span>
              <span class="track-muted">${[item.size, item.color].filter(Boolean).map(escapeHTML).join(" · ")}</span>
            </li>`
            )
            .join("")}
        </ul>
        <p class="track-total">Total <strong>${escapeHTML(formatMoney(order.total))}</strong></p>
      </div>
      <div class="track-ship">
        <h3>Envío</h3>
        ${trackingBlock(order)}
      </div>
    `;
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("");

    if (!config || !config.url || !config.publishableKey) {
      setError("El seguimiento no está disponible en este momento.");
      return;
    }

    const number = parseOrderNumber(form.elements.number.value);
    const email = String(form.elements.email.value || "").trim().toLowerCase();
    if (!number) {
      setError("Escribe un número de pedido válido, por ejemplo LH-1013.");
      form.elements.number.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Escribe el correo con el que hiciste el pedido.");
      form.elements.email.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `${config.url}/rest/v1/rpc/get_order_status`,
        {
          method: "POST",
          headers: {
            apikey: config.publishableKey,
            Authorization: `Bearer ${config.publishableKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_number: number, p_email: email }),
        }
      );
      if (!response.ok) throw new Error("No se pudo consultar el pedido.");
      const order = await response.json();
      if (!order || !order.found) {
        result.hidden = true;
        setError(
          "No encontramos un pedido con ese número y correo. Revisa que coincidan con el correo de confirmación."
        );
        return;
      }
      render(order);
      const url = new URL(location.href);
      url.searchParams.set("pedido", `LH-${order.number}`);
      history.replaceState({}, "", url);
    } catch (error) {
      result.hidden = true;
      setError("No pudimos consultar el pedido. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  });

  const preset = new URLSearchParams(location.search).get("pedido");
  if (preset) {
    form.elements.number.value = preset;
    form.elements.email.focus();
  }
})();
