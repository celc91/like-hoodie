(function () {
  const form = document.querySelector("[data-invoice-form]");
  if (!form) return;

  const submit = document.querySelector("#invoice-submit");
  const errorBox = document.querySelector("#invoice-error");
  const resultBox = document.querySelector("#invoice-result");
  const purchaseEmail = document.querySelector("#invoice-email-purchase");
  const invoiceEmail = document.querySelector("#invoice-email");
  const token = new URLSearchParams(window.location.search).get("token");

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

  function endpoint() {
    const cfg = window.LIKEHOODIE_SUPABASE || {};
    const url = String(cfg.url || "").replace(/\/+$/, "");
    const key = String(cfg.publishableKey || "");
    if (!url || !key) {
      throw new Error("missing-config");
    }
    return { url: url + "/functions/v1/invoice-request", key };
  }

  async function callInvoice(payload) {
    const target = endpoint();
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        apikey: target.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(function () {
      return {};
    });
    return { response, data };
  }

  async function confirmRequest(value) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
      )
    ) {
      showError("El enlace de confirmación no es válido.");
      return;
    }

    form.hidden = true;
    showResult("Confirmando tu solicitud…");

    try {
      const { response, data } = await callInvoice({
        action: "confirm",
        token: value,
      });

      if (!response.ok || data.ok !== true) {
        form.hidden = false;
        showError(
          data.error ||
            "El enlace no es válido o expiró. Vuelve a enviar la solicitud."
        );
        return;
      }

      showResult(
        data.message ||
          "Correo confirmado. Revisaremos tu solicitud y te enviaremos el XML y PDF."
      );
    } catch (error) {
      form.hidden = false;
      showError(
        "No se pudo confirmar la solicitud. Revisa tu conexión e inténtalo de nuevo."
      );
    }
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
    const satPaymentForm = String(data.get("satPaymentForm") || "").trim();
    const notes = String(data.get("notes") || "").trim();

    if (!number) {
      showError("Escribe el número de pedido.");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Enviando…";

    try {
      const { response, data: payload } = await callInvoice({
        number,
        email,
        rfc,
        legalName,
        taxRegime,
        zip,
        cfdiUse,
        invoiceEmail: facturaEmail,
        satPaymentForm,
        notes,
      });

      if (!response.ok) {
        showError(payload.error || "No se pudo enviar la solicitud.");
        return;
      }

      showResult(payload.message || "Solicitud recibida.");
      form.reset();
    } catch (error) {
      if (error && error.message === "missing-config") {
        showError("La solicitud no está disponible en este momento.");
      } else {
        showError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.");
      }
    } finally {
      submit.disabled = false;
      submit.textContent = "Enviar solicitud";
    }
  });

  if (token) {
    confirmRequest(token);
  }
})();
