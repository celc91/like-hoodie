/* ==========================================================================
   like hoodie ♡ — elegir contraseña desde un enlace de recuperación
   --------------------------------------------------------------------------
   Supabase verifica el token y redirige aquí con una sesión temporal. La
   persona escribe su contraseña y se cierra esa sesión; luego entra al panel.
   ========================================================================== */

(function () {
  "use strict";

  const config = window.LIKEHOODIE_SUPABASE || {};
  const form = document.getElementById("clave-form");
  const password = document.getElementById("clave-password");
  const confirm = document.getElementById("clave-confirm");
  const button = document.getElementById("clave-button");
  const errorBox = document.getElementById("clave-error");
  const message = document.getElementById("clave-message");
  const title = document.getElementById("clave-title");
  const subtitle = document.getElementById("clave-sub");

  function setError(text) {
    if (!errorBox) return;
    errorBox.textContent = text || "";
    errorBox.hidden = !text;
  }

  function fail(text) {
    if (form) form.hidden = true;
    if (title) title.textContent = "Este enlace no sirve.";
    if (subtitle) subtitle.textContent = text;
  }

  if (!window.supabase || !config.url || !config.publishableKey) {
    fail("Falta la configuración de Supabase.");
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: {
      storageKey: "likehoodie-recovery",
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: true,
    },
  });

  function showForm() {
    if (form) form.hidden = false;
    if (password) password.focus();
    try {
      window.history.replaceState({}, "", window.location.pathname);
    } catch (error) {
      /* Sin history: el token se queda en la URL, no pasa nada. */
    }
  }

  async function init() {
    const hash = window.location.hash || "";
    const search = window.location.search || "";

    if (/error_description=/.test(hash) || /error_description=/.test(search)) {
      return fail("El enlace caducó o ya se usó. Pide uno nuevo.");
    }

    // supabase-js procesa el hash de forma asíncrona: se reintenta un momento
    // antes de dar el enlace por caducado.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { data } = await client.auth.getSession();
      if (data && data.session) return showForm();
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 250);
      });
    }

    // Flujo PKCE: el token llega como ?code=
    const code = new URLSearchParams(search).get("code");
    if (code) {
      const { data: exchanged, error } = await client.auth.exchangeCodeForSession(code);
      if (!error && exchanged && exchanged.session) return showForm();
    }

    fail("El enlace caducó o ya se usó. Pide uno nuevo.");
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setError("");

      const value = password ? password.value : "";
      if (value.length < 10) {
        setError("Usa al menos 10 caracteres.");
        return;
      }
      if (value !== (confirm ? confirm.value : "")) {
        setError("Las dos contraseñas no coinciden.");
        return;
      }

      if (button) {
        button.disabled = true;
        button.textContent = "Guardando…";
      }

      const { error } = await client.auth.updateUser({ password: value });

      if (button) {
        button.disabled = false;
        button.textContent = "Guardar contraseña";
      }

      if (error) {
        setError(error.message || "No se pudo guardar la contraseña.");
        return;
      }

      await client.auth.signOut().catch(function () {});
      if (form) form.hidden = true;
      if (title) title.textContent = "Contraseña lista.";
      if (subtitle) {
        subtitle.textContent =
          "Entra al panel con tu correo y esta contraseña. La primera vez te pedirá configurar el segundo factor.";
      }
      if (message) {
        message.hidden = false;
        message.innerHTML = '<a class="btn" href="admin.html">Ir al panel</a>';
      }
    });
  }

  init();
})();
