(async function () {
  const title = document.getElementById("confirm-title");
  const text = document.getElementById("confirm-text");
  const result = document.getElementById("confirm-result");
  const home = document.getElementById("confirm-home");

  function fail(message) {
    title.textContent = "No pudimos confirmarlo";
    text.textContent = message;
    home.hidden = false;
    home.textContent = "Volver a la tienda";
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const baja = params.get("baja");

  const cfg = window.LIKEHOODIE_SUPABASE;
  if (!cfg || !window.supabase) {
    fail("El enlace no es válido o falta configuración.");
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey);

  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }

  try {
    if (baja) {
      const data = await rpc("unsubscribe_newsletter", { p_token: baja });
      if (!data || !data.ok) {
        fail("Ese enlace de baja ya no es válido.");
        return;
      }
      title.textContent = "Te has dado de baja";
      text.textContent =
        "No volverás a recibir correos del club. Puedes apuntarte otra vez cuando quieras.";
      home.hidden = false;
      return;
    }

    if (!token) {
      fail("El enlace no incluye un token válido.");
      return;
    }

    const data = await rpc("confirm_newsletter", { p_token: token });

    if (!data || !data.ok) {
      const reasons = {
        notfound: "Ese enlace ya se usó o no existe.",
        unsubscribed: "Ese correo está dado de baja.",
      };
      fail(reasons[data && data.reason] || "No pudimos confirmar tu correo.");
      return;
    }

    if (!data.code) {
      fail("No pudimos recuperar tu código. Escríbenos a hola@likehoodie.com.");
      return;
    }

    title.textContent = "¡Ya estás dentro!";
    text.textContent = "Este es tu código de bienvenida: úsalo en la cesta.";
    const code = document.createElement("span");
    code.className = "confirm-code";
    code.textContent = data.code;
    result.appendChild(code);
    const note = document.createElement("p");
    note.textContent = `${data.percent || 10} % de descuento en tu primer pedido.`;
    result.appendChild(note);
    home.hidden = false;
    home.textContent = "Usar mi código";
  } catch (error) {
    fail("Hubo un problema de conexión. Inténtalo de nuevo en un momento.");
  }
})();
