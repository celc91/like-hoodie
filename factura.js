(function () {
  const form = document.querySelector("[data-invoice-form]");
  if (!form) return;

  const submit = document.querySelector("#invoice-submit");
  const errorBox = document.querySelector("#invoice-error");
  const resultBox = document.querySelector("#invoice-result");
  const purchaseEmail = document.querySelector("#invoice-email-purchase");
  const invoiceEmail = document.querySelector("#invoice-email");

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = !message;
    if (resultBox) resultBox.hidden = true;
  }

  function showResult(message) {
    if (!resultBox) return;
    resultBox.textContent = message;
    resultBox.hidden = !message;
    if (errorBox) errorBox.hidden = true;
  }

  if (purchaseEmail && invoiceEmail) {
    purchaseEmail.addEventListener("change", function () {
      if (!invoiceEmail.value.trim()) invoiceEmail.value = purchaseEmail.value.trim();
    });
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    showError("");

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = new FormData(form);
    const number = Number(String(data.get("number") || "").replace(/\D/g, ""));
    const email = String(data.get("email") || "").trim().toLowerCase();
    const rfc = String(data.get("rfc") || "").trim().toUpperCase();
    const legalName = String(data.get("legalName") || "").trim();
    const taxRegime = String(data.get("taxRegime") || "").trim();
    const zip = String(data.get("zip") || "").trim();
    const cfdiUse = String(data.get("cfdiUse") || "").trim();
    const facturaEmail = String(data.get("invoiceEmail") || "").trim().toLowerCase();
    const notes = String(data.get("notes") || "").trim();

    if (!number) {
      showError("Escribe el número de pedido.");
      return;
    }

    const cfg = window.LIKEHOODIE_SUPABASE || {};
    const url = String(cfg.url || "").replace(/\/+$/, "");
    const key = String(cfg.publishableKey || "");
    if (!url || !key) {
      showError("La solicitud no está disponible en este momento.");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Enviando…";

    try {
      const response = await fetch(url + "/functions/v1/invoice-request", {
        method: "POST",
        headers: {
          apikey: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          number,
          email,
          rfc,
          legalName,
          taxRegime,
          zip,
          cfdiUse,
          invoiceEmail: facturaEmail,
          notes,
        }),
      });

      const payload = await response.json().catch(function () {
        return {};
      });

      if (!response.ok) {
        showError(payload.error || "No se pudo enviar la solicitud.");
        return;
      }

      showResult(payload.message || "Solicitud recibida.");
      form.reset();
    } catch (error) {
      showError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      submit.disabled = false;
      submit.textContent = "Enviar solicitud";
    }
  });
})();
