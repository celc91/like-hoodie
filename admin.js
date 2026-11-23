(() => {
  const config = window.LIKEHOODIE_SUPABASE || {};
  const configured =
    typeof config.url === "string" &&
    typeof config.publishableKey === "string" &&
    config.url.startsWith("https://") &&
    !config.url.includes("TU-PROYECTO") &&
    config.publishableKey.length > 40 &&
    !config.publishableKey.includes("TU_PUBLISHABLE");

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const loginView = $("#login-view");
  const appView = $("#app-view");
  const loginForm = $("#login-form");
  const loginTitle = $("#login-title");
  const loginSub = $("#login-sub");
  const loginError = $("#login-error");
  const loginButton = $("#login-button");
  const mfaPanel = $("#mfa-panel");
  const mfaForm = $("#mfa-form");
  const mfaCode = $("#mfa-code");
  const mfaButton = $("#mfa-button");
  const mfaError = $("#mfa-error");
  const mfaTitle = $("#mfa-title");
  const mfaDesc = $("#mfa-desc");
  const mfaQrWrap = $("#mfa-qr-wrap");
  const mfaQr = $("#mfa-qr");
  const mfaSecretWrap = $("#mfa-secret-wrap");
  const mfaSecret = $("#mfa-secret");
  const mfaCancel = $("#mfa-cancel");
  const billingStart = $("#billing-start");
  const billingEnd = $("#billing-end");
  const billingBody = $("#billing-body");
  const billingEmpty = $("#billing-empty");
  const billingSummary = $("#billing-summary");
  const billingError = $("#billing-error");
  const billingForm = $("#billing-form");
  const billingUuid = $("#billing-uuid");
  const billingNotes = $("#billing-notes");
  const billingRefresh = $("#billing-refresh");
  const billingExport = $("#billing-export");
  const billingMark = $("#billing-mark");
  const billingReminder = $("#billing-reminder");
  const historyBody = $("#history-body");
  const historyEmpty = $("#history-empty");
  const historyError = $("#history-error");
  const historyRefresh = $("#history-refresh");
  const requestsBody = $("#requests-body");
  const requestsEmpty = $("#requests-empty");
  const requestsError = $("#requests-error");
  const requestsRefresh = $("#requests-refresh");
  const requestsStatus = $("#requests-status");
  const setupNote = $("#setup-note");
  const toastEl = $("#toast");

  const STATUS_LABELS = {
    pending: "Pendiente",
    confirmed: "Confirmado",
    production: "En producción",
    shipped: "Enviado",
    delivered: "Entregado",
    cancelled: "Cancelado",
  };

  const APPROVAL_LABELS = {
    pending: "Pendiente de vista previa",
    sent: "Vista previa enviada",
    approved: "Aprobado por el cliente",
    rejected: "Rechazado por el cliente",
  };

  const PAYMENT_LABELS = {
    demo: "Demostración",
    pending: "Pago pendiente",
    paid: "Pagado",
    failed: "Pago fallido",
    cancelled: "Pago cancelado",
    refunded: "Reembolsado",
  };

  let client = null;
  let currentUser = null;
  let currentSection = "resumen";
  let ordersPage = 0;
  let ordersPageSize = 20;
  let ordersTotal = 0;
  let ordersSearch = "";
  let ordersStatus = "";
  let cartsCache = [];
  let toastTimer = null;
  let mfaFactorId = null;
  let idleTimer = null;
  let billingCache = null;
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  const MFA_QR_PLACEHOLDER =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

  const money = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });

  function formatMoney(value) {
    return money.format(Number(value) || 0);
  }

  function formatDate(value, withTime = true) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character];
    });
  }

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.classList.remove("is-visible");
    }, 3200);
  }

  function setLoginError(message) {
    if (!loginError) return;
    loginError.textContent = message;
    loginError.hidden = !message;
  }

  function setMfaError(message) {
    if (!mfaError) return;
    mfaError.textContent = message;
    mfaError.hidden = !message;
  }

  function clearMfaSecrets() {
    if (mfaSecret) mfaSecret.textContent = "";
    if (mfaQr) mfaQr.src = MFA_QR_PLACEHOLDER;
    if (mfaQrWrap) mfaQrWrap.hidden = true;
    if (mfaSecretWrap) mfaSecretWrap.hidden = true;
  }

  function stopIdleTimer() {
    if (idleTimer) {
      window.clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function resetIdleTimer() {
    if (!currentUser || appView.hidden) return;
    stopIdleTimer();
    idleTimer = window.setTimeout(async () => {
      idleTimer = null;
      try {
        await client.auth.signOut();
      } catch (error) {
        console.warn("No se pudo cerrar la sesión inactiva.", error);
      }
      currentUser = null;
      showLogin();
      setLoginError("Sesión cerrada por inactividad. Vuelve a entrar.");
    }, IDLE_TIMEOUT_MS);
  }

  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((eventName) => {
    document.addEventListener(eventName, resetIdleTimer, { passive: true });
  });

  function showLoginView() {
    stopIdleTimer();
    mfaFactorId = null;
    loginView.hidden = false;
    appView.hidden = true;
    loginForm.hidden = false;
    if (loginTitle) loginTitle.hidden = false;
    if (loginSub) loginSub.hidden = false;
    if (mfaPanel) mfaPanel.hidden = true;
    if (mfaCode) mfaCode.value = "";
    clearMfaSecrets();
    setMfaError("");
  }

  function showLogin() {
    showLoginView();
  }

  function showApp() {
    mfaFactorId = null;
    loginView.hidden = true;
    appView.hidden = false;
    if (mfaPanel) mfaPanel.hidden = true;
    clearMfaSecrets();
    resetIdleTimer();
    loadAll();
  }

  function cartDisplayStatus(cart) {
    if (cart.status === "converted") return "converted";
    if (cart.status === "empty") return "empty";
    const age = Date.now() - new Date(cart.updated_at).getTime();
    return age > 60 * 60 * 1000 ? "abandoned" : "open";
  }

  function statusBadge(status) {
    const labels = {
      ...STATUS_LABELS,
      open: "Activo",
      abandoned: "Abandonado",
      converted: "Convertido",
      empty: "Vacío",
    };
    return `<span class="badge status-${escapeHTML(status)}">${escapeHTML(
      labels[status] || status
    )}</span>`;
  }

  function paymentBadge(status) {
    const value = String(status || "demo");
    return `<span class="badge status-${escapeHTML(value)}">${escapeHTML(
      PAYMENT_LABELS[value] || value
    )}</span>`;
  }

  function itemsSummary(items) {
    if (!Array.isArray(items) || !items.length) return "—";
    const first = items[0];
    const rest = items.length - 1;
    return `${escapeHTML(first.name || "Sudadera")}${
      rest > 0 ? ` +${rest}` : ""
    }`;
  }

  function itemsCount(items) {
    if (!Array.isArray(items)) return 0;
    return items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  }

  /* ------------------------------- Auth -------------------------------- */

  async function checkAdmin(user) {
    const { data, error } = await client
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      console.warn(error);
      return false;
    }
    return data?.role === "admin";
  }

  function showMfaPanel() {
    stopIdleTimer();
    loginView.hidden = false;
    appView.hidden = true;
    loginForm.hidden = true;
    if (loginTitle) loginTitle.hidden = true;
    if (loginSub) loginSub.hidden = true;
    mfaPanel.hidden = false;
    window.setTimeout(() => {
      if (mfaCode) mfaCode.focus();
    }, 60);
  }

  function mfaQrSource(value) {
    const text = String(value || "");
    if (text.startsWith("data:image/")) return text;
    if (text.startsWith("<svg")) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    }
    if (text.startsWith("https://")) return text;
    return "";
  }

  async function listVerifiedTotp() {
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw error;
    return (data?.all || []).filter(
      (factor) => factor.factor_type === "totp" && factor.status === "verified"
    );
  }

  async function cleanUnverifiedTotp() {
    try {
      const { data } = await client.auth.mfa.listFactors();
      const factors = (data?.all || []).filter(
        (factor) => factor.factor_type === "totp" && factor.status === "unverified"
      );
      for (const factor of factors) {
        await client.auth.mfa.unenroll({ factorId: factor.id });
      }
    } catch (error) {
      console.warn("No se pudieron limpiar los factores MFA pendientes.", error);
    }
  }

  async function startMfaEnrollment() {
    await cleanUnverifiedTotp();
    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "like hoodie admin",
    });

    if (error) {
      setLoginError("No se pudo activar la verificación en dos pasos.");
      await client.auth.signOut();
      currentUser = null;
      showLogin();
      return;
    }

    mfaFactorId = data.id;
    mfaTitle.textContent = "Activa la verificación en dos pasos";
    mfaDesc.textContent =
      "Es obligatoria para el panel. Escanea el QR con Google Authenticator, 1Password o Authy.";
    const qr = mfaQrSource(data.totp?.qr_code);
    mfaQr.src = qr;
    mfaQrWrap.hidden = !qr;
    mfaSecret.textContent = String(data.totp?.secret || "");
    mfaSecretWrap.hidden = !mfaSecret.textContent;
    mfaCode.value = "";
    setMfaError("");
    showMfaPanel();
  }

  function startMfaChallenge(factor) {
    mfaFactorId = factor.id;
    mfaTitle.textContent = "Verificación en dos pasos";
    mfaDesc.textContent =
      "Escribe el código de 6 dígitos de tu app autenticadora.";
    mfaQrWrap.hidden = true;
    mfaSecretWrap.hidden = true;
    mfaCode.value = "";
    setMfaError("");
    showMfaPanel();
  }

  async function beginAdmin(user) {
    currentUser = user;
    const admin = await checkAdmin(user);
    if (!admin) {
      await client.auth.signOut();
      currentUser = null;
      setLoginError("Esta cuenta no tiene permisos de administrador.");
      showLogin();
      return;
    }

    try {
      const { data: level, error: levelError } =
        await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (levelError) throw levelError;

      const factors = await listVerifiedTotp();
      if (!factors.length) {
        await startMfaEnrollment();
        return;
      }

      if (level?.currentLevel === "aal2") {
        showApp();
        return;
      }

      startMfaChallenge(factors[0]);
    } catch (error) {
      console.error("No se pudo verificar MFA.", error);
      await client.auth.signOut();
      currentUser = null;
      setLoginError("No se pudo verificar la seguridad de la cuenta. Vuelve a entrar.");
      showLogin();
    }
  }

  async function init() {
    if (!configured) {
      setupNote.hidden = false;
      loginButton.disabled = true;
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      setupNote.hidden = false;
      setupNote.textContent =
        "No se pudo cargar Supabase. Revisa tu conexión e inténtalo de nuevo.";
      loginButton.disabled = true;
      return;
    }

    let adminStorage = null;
    try {
      adminStorage = window.sessionStorage;
    } catch (error) {
      adminStorage = null;
    }
    try {
      window.localStorage.removeItem("likehoodie-admin-auth");
    } catch (error) {
      /* Sin localStorage, no hay nada que limpiar. */
    }

    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        storageKey: "likehoodie-admin-auth",
        ...(adminStorage ? { storage: adminStorage } : {}),
        persistSession: Boolean(adminStorage),
        autoRefreshToken: true,
      },
    });

    const { data } = await client.auth.getSession();
    if (data?.session?.user) {
      await beginAdmin(data.session.user);
    } else {
      showLogin();
    }

    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        showLogin();
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setLoginError("");
      const data = new FormData(loginForm);
      const email = String(data.get("email") || "").trim();
      const password = String(data.get("password") || "");
      loginButton.disabled = true;
      loginButton.textContent = "Entrando…";

      const { data: authData, error } = await client.auth.signInWithPassword({
        email,
        password,
      });

      loginButton.disabled = false;
      loginButton.textContent = "Entrar";

      if (error) {
        setLoginError("No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.");
        return;
      }

      await beginAdmin(authData.user);
    });
  }

  if (mfaForm) {
    mfaForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setMfaError("");
      const code = String(mfaCode.value || "").replace(/\D/g, "");
      if (!/^[0-9]{6}$/.test(code) || !mfaFactorId) {
        setMfaError("Escribe un código de 6 dígitos.");
        return;
      }

      mfaButton.disabled = true;
      mfaButton.textContent = "Verificando…";

      const { data: challenge, error: challengeError } =
        await client.auth.mfa.challenge({ factorId: mfaFactorId });

      if (challengeError) {
        mfaButton.disabled = false;
        mfaButton.textContent = "Verificar";
        setMfaError("No se pudo iniciar la verificación. Inténtalo de nuevo.");
        return;
      }

      const { error: verifyError } = await client.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code,
      });

      mfaButton.disabled = false;
      mfaButton.textContent = "Verificar";

      if (verifyError) {
        setMfaError("Código incorrecto o expirado. Inténtalo de nuevo.");
        mfaCode.value = "";
        mfaCode.focus();
        return;
      }

      showApp();
    });
  }

  if (mfaCancel) {
    mfaCancel.addEventListener("click", async () => {
      mfaFactorId = null;
      stopIdleTimer();
      try {
        await client.auth.signOut();
      } catch (error) {
        console.warn("No se pudo cerrar la sesión MFA.", error);
      }
      currentUser = null;
      showLogin();
      setLoginError("Inicio de sesión cancelado.");
    });
  }

  const logoutButton = $("#logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await client.auth.signOut();
      window.location.reload();
    });
  }

  /* ------------------------------ Sections ------------------------------ */

  $$("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.section;
      if (!section) return;
      currentSection = section;
      $$(".tab").forEach((tab) => {
        tab.classList.toggle("is-active", tab === button);
      });
      $$("[data-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== section;
      });
      if (section === "resumen") loadStats();
      if (section === "estadisticas") loadAnalytics();
      if (section === "ventas") loadConversations();
      if (section === "pedidos") loadOrders();
      if (section === "facturacion") {
        loadBilling();
        loadGlobalHistory();
        loadInvoiceRequests();
      }
      if (section === "carritos") loadCarts();
      if (section === "salud") loadHealth();
    });
  });

  const refreshButton = $("#refresh-button");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      loadAll();
      toast("Datos actualizados.");
    });
  }

  const healthRefresh = $("#health-refresh");
  if (healthRefresh) {
    healthRefresh.addEventListener("click", () => {
      loadHealth();
      toast("Monitorización actualizada.");
    });
  }

  const analyticsRefresh = $("#analytics-refresh");
  if (analyticsRefresh) {
    analyticsRefresh.addEventListener("click", () => {
      loadAnalytics();
      toast("Estadísticas actualizadas.");
    });
  }

  const analyticsPeriod = $("#analytics-period");
  if (analyticsPeriod) {
    analyticsPeriod.addEventListener("change", () => loadAnalytics());
  }

  const analyticsCountry = $("#analytics-country");
  if (analyticsCountry) {
    analyticsCountry.addEventListener("change", () => loadAnalytics());
  }

  function loadAll() {
    loadStats();
    loadAnalytics();
    loadConversations();
    loadOrders();
    loadBilling();
    loadGlobalHistory();
    loadInvoiceRequests();
    loadCarts();
    loadHealth();
  }

  /* --------------------------- GA4 y Meta -------------------------------- */

  const ANALYTICS_SETUP = {
    ga: `
      <strong>Conecta Google Analytics 4</strong>
      <p>1. En Google Cloud crea una cuenta de servicio y descarga su clave JSON.</p>
      <p>2. En GA4 → Administrar → Acceso a la propiedad, añádela como <em>Lectora</em>.</p>
      <p>3. En Supabase → Edge Functions → Secrets, crea <code>GA_SERVICE_ACCOUNT</code> con ese JSON (y, si hace falta, <code>GA_PROPERTY_ID</code>).</p>`,
    meta: `
      <strong>Conecta Meta</strong>
      <p>En Business Settings genera un token con <code>ads_read</code> y guárdalo como <code>META_ACCESS_TOKEN</code>. La cuenta publicitaria se toma de <code>META_AD_ACCOUNT_ID</code> o de la predeterminada.</p>`,
  };

  function formatInt(value) {
    return new Intl.NumberFormat("es-MX").format(Number(value) || 0);
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function renderAnalyticsChart(daily) {
    const chart = $("#ga-chart");
    if (!chart) return;

    let points = Array.isArray(daily) ? daily.slice() : [];
    if (points.length > 31) {
      const weeks = [];
      for (let i = 0; i < points.length; i += 7) {
        const slice = points.slice(i, i + 7);
        weeks.push({
          date: slice[0].date,
          users: slice.reduce((sum, row) => sum + (Number(row.users) || 0), 0),
          sessions: slice.reduce((sum, row) => sum + (Number(row.sessions) || 0), 0),
        });
      }
      points = weeks;
    }

    if (!points.length) {
      chart.innerHTML = '<p class="empty">Sin datos en este periodo.</p>';
      return;
    }

    const max = Math.max(1, ...points.map((row) => Number(row.users) || 0));
    chart.innerHTML = points
      .map((row) => {
        const count = Number(row.users) || 0;
        const height = Math.max(3, Math.round((count / max) * 100));
        const date = new Date(`${row.date}T12:00:00`);
        const label = Number.isNaN(date.getTime())
          ? row.date
          : date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
        return `<div class="bar" title="${escapeHTML(label)}: ${count} usuarios · ${
          Number(row.sessions) || 0
        } sesiones">
          <span class="bar-value">${count || ""}</span>
          <span class="bar-fill" style="height:${height}%"></span>
          <span class="bar-label">${escapeHTML(label)}</span>
        </div>`;
      })
      .join("");
  }

  const COUNTRY_NAMES = {
    Mexico: "México",
    "United States": "Estados Unidos",
    Spain: "España",
    Colombia: "Colombia",
    Argentina: "Argentina",
    Chile: "Chile",
    Peru: "Perú",
    Canada: "Canadá",
    France: "Francia",
    Germany: "Alemania",
    "United Kingdom": "Reino Unido",
    Brazil: "Brasil",
    Ecuador: "Ecuador",
    Guatemala: "Guatemala",
    "Costa Rica": "Costa Rica",
    Panama: "Panamá",
    "Dominican Republic": "República Dominicana",
    Bolivia: "Bolivia",
    Uruguay: "Uruguay",
    Venezuela: "Venezuela",
    Honduras: "Honduras",
    "El Salvador": "El Salvador",
    Nicaragua: "Nicaragua",
    Paraguay: "Paraguay",
    Cuba: "Cuba",
    "Puerto Rico": "Puerto Rico",
    India: "India",
    Philippines: "Filipinas",
  };

  function countryLabel(value) {
    const name = String(value || "").trim();
    if (!name || /^\(not set\)$/i.test(name)) return "Sin país";
    return COUNTRY_NAMES[name] || name;
  }

  function renderAnalyticsList(target, rows, emptyText) {
    const element = $(target);
    if (!element) return;
    if (!Array.isArray(rows) || !rows.length) {
      element.innerHTML = `<li><span>${escapeHTML(
        emptyText || "Sin datos"
      )}</span><strong>0</strong></li>`;
      return;
    }
    element.innerHTML = rows
      .map(
        (row) =>
          `<li><span>${escapeHTML(String(row.label || "—"))}</span><strong>${formatInt(
            row.count
          )}</strong></li>`
      )
      .join("");
  }

  function renderAnalytics(data) {
    const ga = data.ga || {};
    const meta = data.meta || {};
    const days = Number(data.days) || 28;
    const rangeLabel = `Últimos ${days} días`;

    const countrySelect = $("#analytics-country");
    let activeCountry = "";
    if (countrySelect) {
      const selected = countrySelect.value;
      const list = Array.isArray(ga.countries) ? ga.countries : [];
      const options = ['<option value="">Todos los países</option>'];
      list.forEach((row) => {
        const raw = String(row.label || "");
        if (!raw || raw === "Sin país") return;
        options.push(
          `<option value="${escapeHTML(raw)}">${escapeHTML(countryLabel(raw))}</option>`
        );
      });
      if (selected && !list.some((row) => String(row.label) === selected)) {
        options.push(
          `<option value="${escapeHTML(selected)}">${escapeHTML(
            countryLabel(selected)
          )}</option>`
        );
      }
      countrySelect.innerHTML = options.join("");
      countrySelect.value = selected;
      activeCountry = countrySelect.value;
    }

    const setup = $("#analytics-setup");
    if (setup) {
      const blocks = [];
      if (ga.configured === false) blocks.push(ANALYTICS_SETUP.ga);
      if (meta.configured === false) blocks.push(ANALYTICS_SETUP.meta);
      if (ga.error) blocks.push(`<strong>GA4 no respondió</strong><p>${escapeHTML(ga.error)}</p>`);
      if (meta.error) blocks.push(`<strong>Meta no respondió</strong><p>${escapeHTML(meta.error)}</p>`);
      setup.innerHTML = blocks.join("");
      setup.hidden = blocks.length === 0;
    }

    const totals = ga.totals || {};
    setText("#ga-users", ga.configured && ga.totals ? formatInt(totals.users) : "—");
    setText("#ga-sessions", ga.configured && ga.totals ? formatInt(totals.sessions) : "—");
    setText("#ga-views", ga.configured && ga.totals ? formatInt(totals.views) : "—");
    setText("#ga-key", ga.configured && ga.totals ? formatInt(totals.keyEvents) : "—");

    setText("#ga-users-note", rangeLabel);
    setText("#ga-sessions-note", ga.totals ? `${formatInt(totals.users)} usuarios` : "");
    setText(
      "#ga-views-note",
      ga.totals && totals.sessions
        ? `${(Number(totals.views) / Number(totals.sessions)).toFixed(1)} por sesión`
        : ""
    );
    setText(
      "#ga-key-note",
      ga.totals
        ? `${formatMoney(totals.revenue)} en ingresos`
        : ""
    );

    const rangeParts = [rangeLabel];
    if (ga.totals) rangeParts.push(formatMoney(totals.revenue));
    if (activeCountry) rangeParts.push(countryLabel(activeCountry));
    setText("#ga-range", rangeParts.join(" · "));
    renderAnalyticsChart(ga.daily);
    renderAnalyticsList("#ga-channels", ga.channels, "Sin sesiones");
    renderAnalyticsList(
      "#ga-countries",
      (ga.countries || []).map((row) => ({
        label: countryLabel(row.label),
        count: row.count,
      })),
      "Sin visitas"
    );
    renderAnalyticsList("#ga-pages", ga.pages, "Sin vistas");
    renderAnalyticsList("#ga-events", ga.events, "Sin eventos");

    const ads = meta.ads || {};
    setText("#meta-spend", meta.configured ? formatMoney(ads.spend) : "—");
    setText("#meta-impressions", meta.configured ? formatInt(ads.impressions) : "—");
    setText("#meta-clicks", meta.configured ? formatInt(ads.clicks) : "—");

    setText("#meta-spend-note", rangeLabel);
    setText(
      "#meta-clicks-note",
      meta.configured && ads.impressions
        ? `Tasa de clics ${(Number(ads.ctr) || 0).toFixed(2)} %`
        : ""
    );
    setText(
      "#meta-ctr-note",
      meta.configured && ads.clicks
        ? `Costo por clic ${formatMoney(ads.cpc)}`
        : ""
    );
    setText("#meta-conversations", meta.configured ? formatInt(ads.conversations) : "—");
    setText(
      "#meta-conversation-note",
      meta.configured && ads.conversations
        ? `${formatMoney(ads.costPerConversation)} por conversación`
        : ""
    );

    const capi = meta.capi;
    const health = $("#meta-health");
    if (health) {
      if (capi && capi.status) {
        const when = capi.cuando ? new Date(capi.cuando) : null;
        const label =
          when && !Number.isNaN(when.getTime())
            ? when.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })
            : "sin fecha";
        health.innerHTML = `Conversions API · último envío <strong>${escapeHTML(
          String(capi.status)
        )}</strong> (${escapeHTML(label)}).`;
      } else {
        health.textContent =
          "Todavía no hay envíos de la Conversions API registrados.";
      }
    }
    setText("#meta-note", meta.configured ? rangeLabel : "Sin token configurado");
  }

  async function loadAnalytics() {
    if (!client) return;
    const periodSelect = $("#analytics-period");
    const countrySelect = $("#analytics-country");
    const days = Number(periodSelect && periodSelect.value) || 28;
    const country = countrySelect ? countrySelect.value : "";
    const button = $("#analytics-refresh");
    if (button) button.disabled = true;

    try {
      const { data: sessionData } = await client.auth.getSession();
      const accessToken = sessionData && sessionData.session
        ? sessionData.session.access_token
        : "";

      if (!accessToken) throw new Error("La sesión no es válida. Vuelve a entrar.");

      const response = await fetch(`${config.url}/functions/v1/stats`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.publishableKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ days, country }),
      });

      if (response.status === 403) {
        throw new Error("Tu sesión no tiene permisos de administrador con MFA.");
      }
      if (!response.ok) {
        throw new Error(`No se pudieron cargar las estadísticas (${response.status}).`);
      }

      const data = await response.json();
      renderAnalytics(data);

      const updated = $("#analytics-updated");
      if (updated) {
        const when = new Date(data.generatedAt || Date.now());
        updated.textContent = `Actualizado ${when.toLocaleTimeString("es-MX", {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      }
    } catch (error) {
      const setup = $("#analytics-setup");
      if (setup) {
        setup.hidden = false;
        setup.innerHTML = `<strong>No se pudieron cargar las estadísticas</strong><p>${escapeHTML(
          error.message || "Error desconocido."
        )}</p>`;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* --------------------------- Enlaces con UTM --------------------------- */

  const UTM_BASE = "https://likehoodie.com";

  function updateUtmLink() {
    const page = $("#utm-page");
    const source = $("#utm-source");
    const medium = $("#utm-medium");
    const campaign = $("#utm-campaign");
    const output = $("#utm-url");
    if (!page || !output) return;

    const url = new URL(page.value || "/", UTM_BASE);
    [
      ["utm_source", source],
      ["utm_medium", medium],
      ["utm_campaign", campaign],
    ].forEach(([key, input]) => {
      const value = String(input && input.value ? input.value : "").trim();
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    });

    output.textContent = url.toString();
  }

  ["#utm-page", "#utm-source", "#utm-medium", "#utm-campaign"].forEach((selector) => {
    const element = $(selector);
    if (!element) return;
    element.addEventListener("input", updateUtmLink);
    element.addEventListener("change", updateUtmLink);
  });

  $$("[data-utm-source]").forEach((button) => {
    button.addEventListener("click", () => {
      const source = $("#utm-source");
      const medium = $("#utm-medium");
      const campaign = $("#utm-campaign");
      if (source) source.value = button.dataset.utmSource || "";
      if (medium) medium.value = button.dataset.utmMedium || "";
      if (campaign) campaign.value = button.dataset.utmCampaign || "";
      updateUtmLink();
    });
  });

  const utmCopy = $("#utm-copy");
  if (utmCopy) {
    utmCopy.addEventListener("click", async () => {
      const output = $("#utm-url");
      const text = output ? output.textContent : "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast("Enlace copiado.");
      } catch (error) {
        const range = document.createRange();
        range.selectNodeContents(output);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        toast("Selecciona y copia el enlace.");
      }
    });
  }

  updateUtmLink();

  /* --------------------------- Ventas / embudo --------------------------- */

  const SALES_STAGES = [
    { id: "nuevo", label: "Nuevo" },
    { id: "respondido", label: "Respondido" },
    { id: "interesado", label: "Interesado" },
    { id: "apartado", label: "Apartado" },
    { id: "cerrado", label: "Cerrado" },
    { id: "perdido", label: "Perdido" },
  ];

  const SOURCE_LABEL = {
    marketplace: "Marketplace",
    meta_ads: "Anuncio Meta",
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    web: "Web",
    otro: "Otro",
  };

  let conversations = [];
  let editingConversation = null;
  let salesView = "board";
  const salesFilter = { query: "", source: "" };

  try {
    salesView = window.localStorage.getItem("lh-sales-view") === "list" ? "list" : "board";
  } catch (error) {
    /* sin almacenamiento */
  }

  function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return "ahora";
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.round(hours / 24);
    return `hace ${days} d`;
  }

  async function loadConversations(options = {}) {
    if (!client) return;
    const { data, error } = await client
      .from("conversations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      if (!options.silent) toast("No se pudieron cargar las conversaciones.");
      return;
    }

    conversations = Array.isArray(data) ? data : [];
    renderConversations();
  }

  function filteredConversations() {
    const query = salesFilter.query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (salesFilter.source && conversation.source !== salesFilter.source) return false;
      if (!query) return true;
      return [conversation.name, conversation.product, conversation.notes].some((value) =>
        String(value || "").toLowerCase().includes(query)
      );
    });
  }

  function renderConversations() {
    const total = conversations.length;
    const won = conversations.filter((c) => c.stage === "cerrado");
    const pending = conversations.filter((c) => c.stage === "nuevo").length;
    const lost = conversations.filter((c) => c.stage === "perdido").length;
    const open = Math.max(0, total - won.length - lost);
    const revenue = won.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const rate = total ? Math.round((won.length / total) * 100) : 0;
    const aov = won.length ? revenue / won.length : 0;

    setText("#sales-total", formatInt(total));
    setText("#sales-open", `${formatInt(open)} abiertas`);
    setText("#sales-pending", formatInt(pending));
    setText("#sales-won", formatInt(won.length));
    setText("#sales-rate", `${rate} % de cierre`);
    setText("#sales-revenue", formatMoney(revenue));
    setText("#sales-aov", `Ticket medio ${formatMoney(aov)}`);

    const badge = $("#sales-badge");
    if (badge) {
      badge.hidden = pending === 0;
      badge.textContent = String(pending);
    }

    const pipelineTotal = conversations.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    setText(
      "#sales-summary",
      `${formatInt(total)} conversaciones · ${formatMoney(pipelineTotal)}`
    );

    const boardButton = $("#sales-view-board");
    const listButton = $("#sales-view-list");
    if (boardButton) boardButton.classList.toggle("is-active", salesView === "board");
    if (listButton) listButton.classList.toggle("is-active", salesView === "list");

    const board = $("#sales-board");
    const list = $("#sales-list");
    if (board) board.hidden = salesView !== "board";
    if (list) list.hidden = salesView !== "list";

    const rows = filteredConversations();

    if (salesView === "board" && board) {
      renderSalesBoard(rows);
    } else {
      renderSalesList(rows);
    }

    const updated = $("#sales-updated");
    if (updated) {
      updated.textContent = `Actualizado ${new Date().toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
  }

  function renderSalesBoard(rows) {
    const board = $("#sales-board");
    if (!board) return;

    const byStage = {};
    rows.forEach((conversation) => {
      (byStage[conversation.stage] = byStage[conversation.stage] || []).push(conversation);
    });

    board.innerHTML = SALES_STAGES.map((stage) => {
      const items = byStage[stage.id] || [];
      const stageTotal = items.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
      const cards = items.length
        ? items
            .map(
              (c) => `<article class="board-card" draggable="true" data-conv-id="${c.id}" tabindex="0">
                <span class="board-card__grip" aria-hidden="true">⋮⋮</span>
                <div class="board-card__top">
                  <strong>${escapeHTML(c.name)}</strong>
                  <span class="source-pill">${escapeHTML(SOURCE_LABEL[c.source] || c.source)}</span>
                </div>
                <p class="board-card__product">${escapeHTML(c.product || "—")}</p>
                ${c.notes ? `<p class="board-card__note">${escapeHTML(c.notes)}</p>` : ""}
                <div class="board-card__meta">
                  <span class="board-card__amount">${
                    Number(c.amount) > 0 ? formatMoney(c.amount) : "—"
                  }</span>
                  <span class="board-card__time">${relativeTime(c.created_at)}</span>
                </div>
              </article>`
            )
            .join("")
        : '<p class="board-empty">Sin conversaciones</p>';

      return `<section class="board-col" data-stage="${stage.id}">
        <header class="board-col__head">
          <div>
            <strong>${stage.label}</strong>
            <small>${items.length} · ${formatMoney(stageTotal)}</small>
          </div>
        </header>
        <div class="board-col__body">${cards}</div>
      </section>`;
    }).join("");
  }



  function renderSalesList(rows) {
    const body = $("#conv-body");
    const empty = $("#conv-empty");
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    body.innerHTML = rows
      .map((c) => {
        const options = SALES_STAGES.map(
          (stage) =>
            `<option value="${stage.id}"${stage.id === c.stage ? " selected" : ""}>${stage.label}</option>`
        ).join("");
        return `<tr>
          <td>${escapeHTML(c.name)}</td>
          <td>${escapeHTML(SOURCE_LABEL[c.source] || c.source)}</td>
          <td>${escapeHTML(c.product || "—")}</td>
          <td><select class="conv-stage" data-conv-stage="${c.id}" aria-label="Etapa de ${escapeHTML(
            c.name
          )}">${options}</select></td>
          <td><input class="conv-amount" type="number" min="0" max="100000" step="1" value="${
            Number(c.amount) || 0
          }" data-conv-amount="${c.id}" aria-label="Monto de ${escapeHTML(c.name)}"></td>
          <td class="conv-note" title="${escapeHTML(c.notes || "")}">${escapeHTML(c.notes || "—")}</td>
          <td><button class="conv-delete" type="button" data-conv-delete="${c.id}">Quitar</button></td>
        </tr>`;
      })
      .join("");
  }

  async function updateConversation(id, patch, options = {}) {
    if (!client || !id) return false;
    const { error } = await client.from("conversations").update(patch).eq("id", id);
    if (error) {
      toast("No se pudo actualizar la conversación.");
      return false;
    }
    const index = conversations.findIndex((c) => c.id === id);
    if (index >= 0) conversations[index] = { ...conversations[index], ...patch };
    renderConversations();
    if (!options.silent) toast("Conversación actualizada.");
    return true;
  }

  async function deleteConversation(id) {
    if (!client || !id) return;
    const { error } = await client.from("conversations").delete().eq("id", id);
    if (error) {
      toast("No se pudo quitar la conversación.");
      return;
    }
    conversations = conversations.filter((c) => c.id !== id);
    renderConversations();
    toast("Conversación quitada.");
  }

  /* ---------------------------- Ficha (modal) ---------------------------- */

  function openConversationModal(conversation) {
    const modal = $("#conv-modal");
    if (!modal) return;

    editingConversation = conversation || null;
    setText("#conv-modal-title", conversation ? "Editar conversación" : "Nueva conversación");

    if ($("#conv-d-name")) $("#conv-d-name").value = conversation ? conversation.name : "";
    if ($("#conv-d-source")) $("#conv-d-source").value = conversation ? conversation.source : "marketplace";
    if ($("#conv-d-stage")) $("#conv-d-stage").value = conversation ? conversation.stage : "nuevo";
    if ($("#conv-d-product")) {
      $("#conv-d-product").value = conversation ? conversation.product : "Sudadera Cocodrilo GTA 6";
    }
    if ($("#conv-d-amount")) {
      $("#conv-d-amount").value = conversation ? Number(conversation.amount) || 0 : "";
    }
    if ($("#conv-d-notes")) $("#conv-d-notes").value = conversation ? conversation.notes || "" : "";
    if ($("#conv-d-delete")) $("#conv-d-delete").hidden = !conversation;

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    modal.removeAttribute("inert");
    document.body.classList.add("is-locked");
    window.setTimeout(() => $("#conv-d-name")?.focus(), 60);
  }

  function closeConversationModal() {
    const modal = $("#conv-modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("inert", "");
    document.body.classList.remove("is-locked");
    editingConversation = null;
  }

  async function saveConversationFromModal() {
    if (!client) return;
    const name = ($("#conv-d-name")?.value || "").trim();
    if (!name) {
      toast("Escribe un nombre.");
      return;
    }

    const payload = {
      name: name.slice(0, 80),
      source: $("#conv-d-source")?.value || "marketplace",
      stage: $("#conv-d-stage")?.value || "nuevo",
      product: ($("#conv-d-product")?.value || "").trim().slice(0, 120),
      amount: Math.max(0, Math.min(100000, Number($("#conv-d-amount")?.value) || 0)),
      notes: ($("#conv-d-notes")?.value || "").trim().slice(0, 1000),
    };

    if (editingConversation) {
      const saved = await updateConversation(editingConversation.id, payload, { silent: true });
      if (!saved) return;
      toast("Conversación actualizada.");
    } else {
      const { data, error } = await client.from("conversations").insert(payload).select().single();
      if (error) {
        toast("No se pudo añadir la conversación.");
        return;
      }
      conversations.unshift(data);
      renderConversations();
      toast("Conversación añadida.");
    }

    closeConversationModal();
  }

  const convSave = $("#conv-d-save");
  if (convSave) convSave.addEventListener("click", saveConversationFromModal);

  const convDelete = $("#conv-d-delete");
  if (convDelete) {
    convDelete.addEventListener("click", () => {
      if (!editingConversation) return;
      if (!window.confirm("¿Quitar esta conversación del embudo?")) return;
      deleteConversation(editingConversation.id);
      closeConversationModal();
    });
  }

  $$("[data-close-conv]").forEach((button) =>
    button.addEventListener("click", closeConversationModal)
  );

  const convModal = $("#conv-modal");
  if (convModal) {
    convModal.addEventListener("click", (event) => {
      if (event.target === convModal) closeConversationModal();
    });
  }

  /* ------------------------- Tablero y lista ----------------------------- */

  const salesBoard = $("#sales-board");
  if (salesBoard) {
    salesBoard.addEventListener("click", (event) => {
      if (event.target.closest(".board-col__head")) return;
      const card = event.target.closest("[data-conv-id]");
      if (!card) return;
      const conversation = conversations.find((c) => c.id === card.dataset.convId);
      if (conversation) openConversationModal(conversation);
    });

    salesBoard.addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-conv-id]");
      if (!card) return;
      event.dataTransfer.setData("text/plain", card.dataset.convId);
      event.dataTransfer.effectAllowed = "move";
      card.classList.add("is-dragging");
    });

    salesBoard.addEventListener("dragend", (event) => {
      const card = event.target.closest("[data-conv-id]");
      if (card) card.classList.remove("is-dragging");
      salesBoard.querySelectorAll(".board-col.is-over").forEach((col) => col.classList.remove("is-over"));
    });

    salesBoard.addEventListener("dragover", (event) => {
      const col = event.target.closest(".board-col");
      if (!col) return;
      event.preventDefault();
      col.classList.add("is-over");
    });

    salesBoard.addEventListener("dragleave", (event) => {
      const col = event.target.closest(".board-col");
      if (!col) return;
      if (!col.contains(event.relatedTarget)) col.classList.remove("is-over");
    });

    salesBoard.addEventListener("drop", (event) => {
      const col = event.target.closest(".board-col");
      if (!col) return;
      event.preventDefault();
      col.classList.remove("is-over");
      const id = event.dataTransfer.getData("text/plain");
      const stage = col.dataset.stage;
      const conversation = conversations.find((c) => c.id === id);
      if (!conversation || !stage || conversation.stage === stage) return;
      updateConversation(id, { stage });
    });
  }

  const convBody = $("#conv-body");
  if (convBody) {
    convBody.addEventListener("change", (event) => {
      const stage = event.target.closest("[data-conv-stage]");
      if (stage) {
        updateConversation(stage.dataset.convStage, { stage: stage.value });
        return;
      }
      const amount = event.target.closest("[data-conv-amount]");
      if (amount) {
        updateConversation(amount.dataset.convAmount, {
          amount: Math.max(0, Math.min(100000, Number(amount.value) || 0)),
        });
      }
    });

    convBody.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-conv-delete]");
      if (!remove) return;
      if (!window.confirm("¿Quitar esta conversación del embudo?")) return;
      deleteConversation(remove.dataset.convDelete);
    });
  }

  const salesSearch = $("#sales-search");
  if (salesSearch) {
    salesSearch.addEventListener("input", () => {
      salesFilter.query = salesSearch.value;
      renderConversations();
    });
  }

  const salesSource = $("#sales-source");
  if (salesSource) {
    salesSource.addEventListener("change", () => {
      salesFilter.source = salesSource.value;
      renderConversations();
    });
  }

  const salesViewBoard = $("#sales-view-board");
  if (salesViewBoard) {
    salesViewBoard.addEventListener("click", () => {
      salesView = "board";
      try {
        window.localStorage.setItem("lh-sales-view", "board");
      } catch (error) {
        /* sin almacenamiento */
      }
      renderConversations();
    });
  }

  const salesViewList = $("#sales-view-list");
  if (salesViewList) {
    salesViewList.addEventListener("click", () => {
      salesView = "list";
      try {
        window.localStorage.setItem("lh-sales-view", "list");
      } catch (error) {
        /* sin almacenamiento */
      }
      renderConversations();
    });
  }

  const salesNew = $("#sales-new");
  if (salesNew) salesNew.addEventListener("click", () => openConversationModal(null));

  // Auto-refresco: cada 60 s y al volver a la pestaña.
  window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const app = $("#app-view");
    if (app && !app.hidden) loadConversations({ silent: true });
  }, 60000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentSection === "ventas") {
      loadConversations({ silent: true });
    }
  });

  /* ------------------------------- Stats -------------------------------- */

  function renderRank(target, rows) {
    const element = $(target);
    if (!element) return;
    if (!Array.isArray(rows) || !rows.length) {
      element.innerHTML = '<li><span>Sin datos todavía</span><strong>0</strong></li>';
      return;
    }
    element.innerHTML = rows
      .map(
        (row) =>
          `<li><span>${escapeHTML(row.label || "—")}</span><strong>${escapeHTML(
            row.count
          )}</strong></li>`
      )
      .join("");
  }

  function renderChart(series) {
    const chart = $("#orders-chart");
    if (!chart) return;
    if (!Array.isArray(series) || !series.length) {
      chart.innerHTML = '<p class="empty">Sin pedidos todavía.</p>';
      return;
    }
    const max = Math.max(1, ...series.map((row) => Number(row.orders) || 0));
    chart.innerHTML = series
      .map((row) => {
        const count = Number(row.orders) || 0;
        const height = Math.max(3, Math.round((count / max) * 100));
        const date = new Date(`${row.day}T12:00:00`);
        const label = date.toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
        });
        return `<div class="bar" title="${escapeHTML(label)}: ${count} pedidos · ${formatMoney(
          row.revenue
        )}">
          <span class="bar-value">${count || ""}</span>
          <span class="bar-fill" style="height:${height}%"></span>
          <span class="bar-label">${escapeHTML(label)}</span>
        </div>`;
      })
      .join("");
  }

  async function loadStats() {
    if (!currentUser) return;
    const { data, error } = await client.rpc("admin_stats", { p_days: 30 });
    if (error) {
      console.warn(error);
      toast("No se pudieron cargar las métricas.");
      return;
    }

    const set = (id, value) => {
      const element = $(id);
      if (element) element.textContent = value;
    };

    const orders30 = Number(data.orders_30) || 0;
    const openCarts = Number(data.carts_open) || 0;
    const convertedCarts = Number(data.carts_converted) || 0;

    set("#kpi-orders-today", data.orders_today ?? 0);
    set(
      "#kpi-orders-30",
      `${orders30} pedido${orders30 === 1 ? "" : "s"} en 30 días`
    );
    set("#kpi-revenue-30", formatMoney(data.revenue_30));
    set("#kpi-aov", `Ticket promedio ${formatMoney(data.aov_30)}`);
    set("#kpi-abandoned", data.carts_abandoned ?? 0);
    set(
      "#kpi-open",
      `${openCarts} carrito${openCarts === 1 ? "" : "s"} activo${
        openCarts === 1 ? "" : "s"
      }`
    );
    set("#kpi-conversion", `${data.conversion ?? 0}%`);
    set(
      "#kpi-converted",
      `${convertedCarts} carrito${convertedCarts === 1 ? "" : "s"} convertido${
        convertedCarts === 1 ? "" : "s"
      }`
    );

    const updated = $("#updated-at");
    if (updated) updated.textContent = `Actualizado ${formatDate(new Date())}`;

    renderChart(data.series);
    renderRank("#top-techniques", data.top_techniques);
    renderRank("#top-materials", data.top_materials);
    renderRank("#top-colors", data.top_colors);
    renderRank("#top-sizes", data.top_sizes);
  }

  /* ------------------------------- Orders ------------------------------- */

  function orderFilters(query) {
    if (ordersStatus) query = query.eq("status", ordersStatus);
    if (ordersSearch) {
      const term = ordersSearch.replace(/[%,()]/g, "").trim();
      if (term) {
        const filters = [
          `customer_name.ilike.%${term}%`,
          `email.ilike.%${term}%`,
        ];
        if (/^\d+$/.test(term)) filters.push(`number.eq.${term}`);
        query = query.or(filters.join(","));
      }
    }
    return query;
  }

  async function loadOrders() {
    if (!currentUser) return;
    const from = ordersPage * ordersPageSize;
    let query = client
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + ordersPageSize - 1);
    query = orderFilters(query);

    const { data, error, count } = await query;
    if (error) {
      console.warn(error);
      toast("No se pudieron cargar los pedidos.");
      return;
    }

    ordersTotal = count || 0;
    renderOrders(data || []);
  }

  function renderOrders(orders) {
    const body = $("#orders-body");
    const empty = $("#orders-empty");
    if (!body) return;

    if (!orders.length) {
      body.innerHTML = "";
      if (empty) empty.hidden = false;
    } else {
      if (empty) empty.hidden = true;
      body.innerHTML = orders
        .map(
          (order) => `<tr>
            <td><span class="order-number">LH-${escapeHTML(order.number)}</span></td>
            <td>${escapeHTML(formatDate(order.created_at))}</td>
            <td>
              <span class="customer-name">${escapeHTML(order.customer_name)}</span>
              <span class="customer-email">${escapeHTML(order.email)}</span>
            </td>
            <td><span class="items-summary">${itemsSummary(order.items)} · ${itemsCount(
            order.items
          )} u.</span></td>
            <td class="design-cell">${designShot(
              Array.isArray(order.items) ? order.items[0] : null,
              "front",
              "",
              "design-shot--mini"
            )}</td>
            <td>
              <strong>${formatMoney(order.total)}</strong>
              <span class="order-payment">${paymentBadge(order.payment_status)}</span>
            </td>
            <td>
              <select class="status-select order-status-select" data-id="${escapeHTML(
                order.id
              )}" aria-label="Estado del pedido">
                ${Object.entries(STATUS_LABELS)
                  .map(
                    ([value, label]) =>
                      `<option value="${value}" ${
                        value === order.status ? "selected" : ""
                      }>${label}</option>`
                  )
                  .join("")}
              </select>
            </td>
            <td><button class="link-btn" type="button" data-order-id="${escapeHTML(
              order.id
            )}">Ver</button></td>
          </tr>`
        )
        .join("");
    }

    hydrateLogoImages(body);

    const pageLabel = $("#orders-page");    if (pageLabel) {
      const pages = Math.max(1, Math.ceil(ordersTotal / ordersPageSize));
      pageLabel.textContent = `Página ${ordersPage + 1} de ${pages}`;
    }
    const prev = $("#orders-prev");
    const next = $("#orders-next");
    if (prev) prev.disabled = ordersPage === 0;
    if (next) next.disabled = (ordersPage + 1) * ordersPageSize >= ordersTotal;
  }

  function billingDateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function setDefaultBillingWeek() {
    if (!billingStart || !billingEnd) return;
    if (billingStart.value && billingEnd.value) return;
    const now = new Date();
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - now.getDay()
    );
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    billingStart.value = billingDateValue(start);
    billingEnd.value = billingDateValue(end);
  }

  function billingBadge(status) {
    const labels = {
      pending: "Pendiente",
      individual: "Individual",
      global: "Global",
    };
    const classes = {
      pending: "status-pending",
      individual: "status-production",
      global: "status-delivered",
    };
    return `<span class="badge ${classes[status] || "status-pending"}">${escapeHTML(
      labels[status] || status
    )}</span>`;
  }

  function billingCard(label, count, total) {
    return `<article class="billing-card">
      <span>${escapeHTML(label)}</span>
      <strong>${Number(count) || 0}</strong>
      ${total == null ? "" : `<small>${formatMoney(total)}</small>`}
    </article>`;
  }

  function setBillingError(message) {
    if (!billingError) return;
    billingError.textContent = message;
    billingError.hidden = !message;
  }

  function renderBillingReminder(pending) {
    if (!billingReminder) return;
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: "America/Mexico_City",
    })
      .format(new Date())
      .toLowerCase();
    const closingDay = weekday === "sun" || weekday === "mon";
    if (pending > 0) {
      const ordersText = `${pending} pedido${pending === 1 ? "" : "s"} pagado${
        pending === 1 ? "" : "s"
      } sin factura global`;
      billingReminder.textContent = closingDay
        ? `Cierre semanal pendiente: hay ${ordersText}. Emite la global dentro de las 24 horas siguientes al domingo.`
        : `Hay ${ordersText}. El cierre semanal es el domingo; la global se emite dentro de las 24 horas siguientes.`;
      billingReminder.hidden = false;
    } else {
      billingReminder.hidden = true;
      billingReminder.textContent = "";
    }
  }

  function renderBilling(data) {
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    const summary = data?.summary || {};

    const pending =
      (Number(summary.pending_04) || 0) +
      (Number(summary.pending_28) || 0) +
      (Number(summary.pending_none) || 0);
    renderBillingReminder(pending);

    if (billingSummary) {
      billingSummary.innerHTML = [
        billingCard("04 · Crédito", summary.pending_04, summary.total_04),
        billingCard("28 · Débito", summary.pending_28, summary.total_28),
        billingCard("Sin forma SAT", summary.pending_none, null),
        billingCard("Facturas individuales", summary.individual, null),
        billingCard("Ya en global", summary.global, null),
      ].join("");
    }

    if (!billingBody) return;
    if (billingEmpty) billingEmpty.hidden = orders.length > 0;

    billingBody.innerHTML = orders
      .map((order) => {
        const status = order.billing_status || "pending";
        const form = order.sat_payment_form || "";
        const isGlobal = status === "global";
        const options = [
          ["", "Sin forma"],
          ["04", "04 · Crédito"],
          ["28", "28 · Débito"],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}" ${value === form ? "selected" : ""}>${label}</option>`
          )
          .join("");
        const actions = isGlobal
          ? ""
          : `<button class="btn btn-ghost" type="button" data-billing-save>Guardar</button>${
              status === "individual"
                ? '<button class="btn btn-ghost" type="button" data-billing-reactivate>Pendiente</button>'
                : '<button class="btn btn-ghost" type="button" data-billing-individual>Individual</button>'
            }`;
        return `<tr data-billing-order="${escapeHTML(order.id)}" data-billing-status="${escapeHTML(
          status
        )}">
          <td><span class="order-number">LH-${escapeHTML(order.number)}</span></td>
          <td>${escapeHTML(formatDate(order.created_at))}</td>
          <td><strong>${formatMoney(order.total)}</strong></td>
          <td>
            <select class="billing-form-select" data-billing-form ${
              isGlobal ? "disabled" : ""
            } aria-label="Forma de pago SAT del pedido LH-${escapeHTML(order.number)}">
              ${options}
            </select>
          </td>
          <td>
            ${billingBadge(status)}
            ${
              order.billing_uuid
                ? `<span class="order-payment">${escapeHTML(order.billing_uuid)}</span>`
                : ""
            }
          </td>
          <td><div class="billing-row-actions">${actions}</div></td>
        </tr>`;
      })
      .join("");
  }

  async function loadBilling() {
    if (!billingStart || !billingEnd) return;
    setDefaultBillingWeek();
    const start = billingStart.value;
    const end = billingEnd.value;
    if (!start || !end || start > end) {
      toast("El periodo de facturación no es válido.");
      return;
    }

    const { data, error } = await client.rpc("global_invoice_preview", {
      p_start: start,
      p_end: end,
    });

    if (error) {
      console.warn(error);
      toast("No se pudo cargar la facturación.");
      return;
    }

    billingCache = data;
    renderBilling(data);
  }

  async function setBillingOrder(orderId, status, form) {
    const { error } = await client.rpc("set_order_billing", {
      p_order_id: orderId,
      p_status: status,
      p_sat_form: form || null,
    });
    if (error) {
      console.warn(error);
      toast("No se pudo actualizar la facturación del pedido.");
      return;
    }
    toast("Facturación del pedido actualizada.");
    loadBilling();
  }

  async function markGlobalInvoice() {
    if (!billingStart || !billingEnd || !billingForm) return;
    const start = billingStart.value;
    const end = billingEnd.value;
    const uuid = String(billingUuid.value || "").trim();
    const notes = String(billingNotes.value || "").trim();

    if (!start || !end || start > end) {
      setBillingError("El periodo no es válido.");
      return;
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        uuid
      )
    ) {
      setBillingError("Escribe un UUID válido de 36 caracteres.");
      return;
    }

    setBillingError("");
    const { data, error } = await client.rpc("create_global_invoice", {
      p_start: start,
      p_end: end,
      p_payment_form: billingForm.value,
      p_uuid: uuid,
      p_notes: notes,
    });

    if (error) {
      console.warn(error);
      setBillingError(
        "No se pudo registrar. Revisa que haya pedidos pendientes con esa forma de pago."
      );
      return;
    }

    billingUuid.value = "";
    billingNotes.value = "";
    toast(
      `Global registrada: ${data.orders} pedidos · ${formatMoney(data.total)}.`
    );
    loadBilling();
    loadGlobalHistory();
  }

  function setHistoryError(message) {
    if (!historyError) return;
    historyError.textContent = message || "";
    historyError.hidden = !message;
  }

  function renderGlobalHistory(invoices) {
    if (!historyBody) return;
    if (historyEmpty) historyEmpty.hidden = invoices.length > 0;

    historyBody.innerHTML = invoices
      .map(
        (invoice) => `<tr>
          <td>${escapeHTML(invoice.period_start)} → ${escapeHTML(invoice.period_end)}</td>
          <td>${escapeHTML(invoice.payment_form)} · ${
            invoice.payment_form === "04" ? "Crédito" : "Débito"
          }</td>
          <td><strong>${formatMoney(invoice.total)}</strong></td>
          <td><span class="order-payment">${escapeHTML(invoice.uuid)}</span></td>
          <td>${escapeHTML(formatDate(invoice.issued_at))}</td>
          <td>${invoice.notes ? escapeHTML(invoice.notes) : "—"}</td>
        </tr>`
      )
      .join("");
  }

  async function loadGlobalHistory() {
    if (!historyBody) return;
    setHistoryError("");

    const { data, error } = await client
      .from("global_invoices")
      .select("period_start, period_end, payment_form, total, uuid, issued_at, notes")
      .order("issued_at", { ascending: false })
      .limit(24);

    if (error) {
      console.warn(error);
      setHistoryError(
        "No se pudo cargar el historial de globales. Revisa que la migración fase9 esté aplicada."
      );
      return;
    }

    renderGlobalHistory(Array.isArray(data) ? data : []);
  }

  const REQUEST_STATUS_LABELS = {
    unverified: "Sin confirmar",
    pending: "Pendiente",
    review: "Revisar",
    issued: "Emitida",
    cancelled: "Cancelada",
  };

  function requestBadge(status) {
    const classes = {
      unverified: "status-abandoned",
      pending: "status-pending",
      review: "status-production",
      issued: "status-delivered",
      cancelled: "status-cancelled",
    };
    return `<span class="badge ${classes[status] || "status-pending"}">${escapeHTML(
      REQUEST_STATUS_LABELS[status] || status
    )}</span>`;
  }

  function setRequestsError(message) {
    if (!requestsError) return;
    requestsError.textContent = message || "";
    requestsError.hidden = !message;
  }

  function renderInvoiceRequests(requests) {
    if (!requestsBody) return;
    if (requestsEmpty) requestsEmpty.hidden = requests.length > 0;

    requestsBody.innerHTML = requests
      .map((request) => {
        const status = request.status || "pending";
        const form = request.sat_payment_form || "";
        const fiscal = [
          `<strong class="request-rfc">${escapeHTML(request.rfc)}</strong>`,
          escapeHTML(request.legal_name),
          `Régimen ${escapeHTML(request.tax_regime)} · CP ${escapeHTML(request.zip)}`,
          `Uso ${escapeHTML(request.cfdi_use)}`,
          escapeHTML(request.invoice_email),
          request.notes ? `Nota: ${escapeHTML(request.notes)}` : "",
        ]
          .filter(Boolean)
          .map((line) => `<span>${line}</span>`)
          .join("");

        let actions = "";
        if (status === "unverified") {
          actions = `<div class="request-actions">
              <button class="btn btn-ghost" type="button" data-request-resend>Reenviar correo</button>
              <button class="btn btn-ghost" type="button" data-request-cancel>Cancelar</button>
            </div>`;
        } else if (status === "review") {
          actions = `<div class="request-actions">
              <input class="request-uuid" type="text" maxlength="36" autocomplete="off" spellcheck="false" placeholder="UUID del CFDI" aria-label="UUID de la factura del pedido LH-${escapeHTML(
                request.order_number
              )}" data-request-uuid>
              <button class="btn btn-ghost" type="button" data-request-issue>Marcar emitida</button>
              <button class="btn btn-ghost" type="button" data-request-cancel>Cancelar</button>
            </div>`;
        } else if (status !== "issued") {
          actions = `<div class="request-actions">
              <button class="btn btn-ghost" type="button" data-request-cancel>Cancelar</button>
            </div>`;
        }

        const statusDetail =
          status === "unverified" && request.verification_sent_at
            ? `<span class="customer-email">Correo enviado ${escapeHTML(
                formatDate(request.verification_sent_at)
              )}</span>`
            : status === "review" && request.verified_at
              ? `<span class="customer-email">Correo confirmado ${escapeHTML(
                  formatDate(request.verified_at)
                )}</span>`
              : "";

        return `<tr data-request-id="${escapeHTML(request.id)}">
          <td>
            <span class="order-number">LH-${escapeHTML(request.order_number)}</span>
            <span class="customer-email">${escapeHTML(request.purchase_email)}</span>
          </td>
          <td>${escapeHTML(formatDate(request.created_at))}</td>
          <td><div class="request-fiscal">${fiscal}</div></td>
          <td>${form ? `${escapeHTML(form)} · ${form === "04" ? "Crédito" : "Débito"}` : "—"}</td>
          <td>${requestBadge(status)}${statusDetail}</td>
          <td>${
            request.uuid
              ? `<span class="order-payment">${escapeHTML(request.uuid)}</span><span class="customer-email">${escapeHTML(
                  formatDate(request.issued_at)
                )}</span>`
              : "—"
          }</td>
          <td>${actions}</td>
        </tr>`;
      })
      .join("");
  }

  async function loadInvoiceRequests() {
    if (!requestsBody) return;
    setRequestsError("");

    const query = client
      .from("invoice_requests")
      .select(
        "id, order_number, purchase_email, rfc, legal_name, tax_regime, zip, cfdi_use, invoice_email, notes, status, sat_payment_form, uuid, issued_at, verification_sent_at, verified_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (requestsStatus && requestsStatus.value) {
      query.eq("status", requestsStatus.value);
    }

    const { data, error } = await query;

    if (error) {
      console.warn(error);
      setRequestsError(
        "No se pudieron cargar las solicitudes individuales. Revisa que la migración de facturación esté aplicada."
      );
      return;
    }

    renderInvoiceRequests(Array.isArray(data) ? data : []);
  }

  async function issueInvoiceRequest(id, uuid) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        uuid
      )
    ) {
      setRequestsError("Escribe un UUID válido de 36 caracteres.");
      return;
    }
    setRequestsError("");

    const { error } = await client.rpc("mark_invoice_request_issued", {
      p_request_id: id,
      p_uuid: uuid,
    });
    if (error) {
      console.warn(error);
      setRequestsError(
        "No se pudo marcar como emitida. Confirma que el cliente validó el correo y que el pedido no está en una global."
      );
      return;
    }

    toast("Solicitud marcada como emitida.");
    loadInvoiceRequests();
    loadBilling();
  }

  async function cancelInvoiceRequest(id) {
    setRequestsError("");
    const { error } = await client.rpc("cancel_invoice_request", {
      p_request_id: id,
    });
    if (error) {
      console.warn(error);
      setRequestsError("No se pudo cancelar la solicitud.");
      return;
    }
    toast("Solicitud cancelada.");
    loadInvoiceRequests();
    loadBilling();
  }

  async function resendInvoiceVerification(id) {
    setRequestsError("");
    const { data, error } = await client.rpc("resend_invoice_verification", {
      p_request_id: id,
    });
    if (error) {
      console.warn(error);
      setRequestsError("No se pudo reenviar el correo de confirmación.");
      return;
    }
    toast(
      data && data.email_sent
        ? "Correo de confirmación reenviado."
        : "No se pudo enviar el correo. Revisa la configuración de Resend."
    );
    loadInvoiceRequests();
  }

  const ordersBody = $("#orders-body");
  if (ordersBody) {
    ordersBody.addEventListener("change", async (event) => {
      const select = event.target.closest(".order-status-select");
      if (!select) return;
      const id = select.dataset.id;
      const status = select.value;
      select.disabled = true;
      const { error } = await client
        .from("orders")
        .update({ status })
        .eq("id", id);
      select.disabled = false;
      if (error) {
        toast("No se pudo cambiar el estado.");
        return;
      }
      toast("Estado actualizado.");
      loadStats();
      loadOrders();
    });

    ordersBody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-order-id]");
      if (!button) return;
      openOrder(button.dataset.orderId);
    });
  }

  if (billingBody) {
    billingBody.addEventListener("click", (event) => {
      const button = event.target.closest(
        "[data-billing-save], [data-billing-individual], [data-billing-reactivate]"
      );
      if (!button) return;
      const row = button.closest("[data-billing-order]");
      if (!row) return;
      const formSelect = row.querySelector("[data-billing-form]");
      const form = formSelect ? formSelect.value : "";
      const current = row.dataset.billingStatus || "pending";
      const status = button.hasAttribute("data-billing-individual")
        ? "individual"
        : button.hasAttribute("data-billing-reactivate")
          ? "pending"
          : current;
      setBillingOrder(row.dataset.billingOrder, status, form);
    });
  }

  if (billingRefresh) {
    billingRefresh.addEventListener("click", () => loadBilling());
  }
  if (billingStart) {
    billingStart.addEventListener("change", () => loadBilling());
  }
  if (billingEnd) {
    billingEnd.addEventListener("change", () => loadBilling());
  }
  if (billingExport) {
    billingExport.addEventListener("click", () => {
      const orders = Array.isArray(billingCache?.orders)
        ? billingCache.orders
        : [];
      if (!orders.length) {
        toast("No hay pedidos en el periodo.");
        return;
      }
      const rows = [
        ["Pedido", "Fecha", "Total", "Forma SAT", "Facturación"],
        ...orders.map((order) => [
          `LH-${order.number}`,
          formatDate(order.created_at, false),
          order.total,
          order.sat_payment_form || "",
          order.billing_status || "pending",
        ]),
      ];
      downloadCSV(
        `facturacion-global-${billingStart.value}_${billingEnd.value}.csv`,
        rows
      );
      toast("CSV exportado.");
    });
  }
  if (billingMark) {
    billingMark.addEventListener("click", () => markGlobalInvoice());
  }

  if (historyRefresh) {
    historyRefresh.addEventListener("click", () => loadGlobalHistory());
  }

  if (requestsRefresh) {
    requestsRefresh.addEventListener("click", () => loadInvoiceRequests());
  }

  if (requestsStatus) {
    requestsStatus.addEventListener("change", () => loadInvoiceRequests());
  }

  if (requestsBody) {
    requestsBody.addEventListener("click", (event) => {
      const issue = event.target.closest("[data-request-issue]");
      const cancel = event.target.closest("[data-request-cancel]");
      const resend = event.target.closest("[data-request-resend]");
      const row = event.target.closest("[data-request-id]");
      if (!row) return;

      if (issue) {
        const input = row.querySelector("[data-request-uuid]");
        issueInvoiceRequest(row.dataset.requestId, String(input?.value || "").trim());
        return;
      }

      if (resend) {
        resendInvoiceVerification(row.dataset.requestId);
        return;
      }

      if (cancel) {
        if (
          !window.confirm(
            "¿Cancelar esta solicitud? El pedido volverá a quedar pendiente para la factura global."
          )
        ) {
          return;
        }
        cancelInvoiceRequest(row.dataset.requestId);
      }
    });
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-reprocess]");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const { error } = await client.functions.invoke("process-logo", {
        body: { assetId: button.dataset.reprocess, stage: "cutout" },
      });
      toast(error ? "No se pudo reprocesar." : "Reproceso iniciado.");
    } catch (error) {
      toast("No se pudo reprocesar.");
    } finally {
      button.disabled = false;
    }
  });

  const searchInput = $("#orders-search");
  if (searchInput) {
    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      if (searchTimer) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        ordersSearch = searchInput.value;
        ordersPage = 0;
        loadOrders();
      }, 350);
    });
  }

  const statusFilter = $("#orders-status");
  if (statusFilter) {
    statusFilter.addEventListener("change", () => {
      ordersStatus = statusFilter.value;
      ordersPage = 0;
      loadOrders();
    });
  }

  const prevButton = $("#orders-prev");
  if (prevButton) {
    prevButton.addEventListener("click", () => {
      if (ordersPage > 0) {
        ordersPage -= 1;
        loadOrders();
      }
    });
  }

  const nextButton = $("#orders-next");
  if (nextButton) {
    nextButton.addEventListener("click", () => {
      if ((ordersPage + 1) * ordersPageSize < ordersTotal) {
        ordersPage += 1;
        loadOrders();
      }
    });
  }

  /* ------------------------------- Carts -------------------------------- */

  async function loadCarts() {
    if (!currentUser) return;
    const { data, error } = await client
      .from("carts")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(300);

    if (error) {
      console.warn(error);
      toast("No se pudieron cargar los carritos.");
      return;
    }

    cartsCache = (data || []).map((cart) => ({
      ...cart,
      display_status: cartDisplayStatus(cart),
    }));

    const select = $("#carts-status");
    const filter = select ? select.value : "abandoned";
    const filtered = filter
      ? cartsCache.filter((cart) => cart.display_status === filter)
      : cartsCache;
    renderCarts(filtered);
  }

  const FAILURE_EVENTS = ["checkout_failed", "print_failed", "model_purchase_failed"];

  async function loadHealth() {
    if (!currentUser) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [errorsResult, eventsResult, ...counts] = await Promise.all([
      client
        .from("client_errors")
        .select("created_at, path, message, source")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50),
      client
        .from("events")
        .select("created_at, name, path, metadata")
        .in("name", FAILURE_EVENTS)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50),
      client
        .from("client_errors")
        .select("*", { count: "exact", head: true })
        .gte("created_at", since),
      ...FAILURE_EVENTS.map((name) =>
        client
          .from("events")
          .select("*", { count: "exact", head: true })
          .eq("name", name)
          .gte("created_at", since)
      ),
    ]);

    if (errorsResult.error || eventsResult.error) {
      console.warn(errorsResult.error || eventsResult.error);
      toast("No se pudo cargar la monitorización.");
      return;
    }

    const setCount = (selector, value) => {
      const el = $(selector);
      if (el) el.textContent = String(value);
    };
    setCount("#health-errors-count", counts[0]?.count || 0);
    setCount("#health-checkout-count", counts[1]?.count || 0);
    setCount("#health-print-count", counts[2]?.count || 0);
    setCount("#health-model-count", counts[3]?.count || 0);

    const errors = errorsResult.data || [];
    const errorsBody = $("#health-errors-body");
    const errorsEmpty = $("#health-errors-empty");
    if (errorsBody) {
      errorsBody.innerHTML = errors
        .map(
          (row) => `<tr>
            <td>${escapeHTML(formatDate(row.created_at))}</td>
            <td>${escapeHTML(row.path || "—")}</td>
            <td class="health-message" title="${escapeHTML(row.message || "")}">${escapeHTML(
              row.message || "—"
            )}</td>
          </tr>`
        )
        .join("");
    }
    if (errorsEmpty) errorsEmpty.hidden = errors.length > 0;

    const events = eventsResult.data || [];
    const eventsBody = $("#health-events-body");
    const eventsEmpty = $("#health-events-empty");
    if (eventsBody) {
      eventsBody.innerHTML = events
        .map((row) => {
          let detail = "";
          try {
            detail = JSON.stringify(row.metadata || {});
          } catch (error) {
            detail = "";
          }
          return `<tr>
            <td>${escapeHTML(formatDate(row.created_at))}</td>
            <td>${escapeHTML(row.name || "—")}</td>
            <td>${escapeHTML(row.path || "—")}</td>
            <td class="health-message" title="${escapeHTML(detail)}">${escapeHTML(
              detail.slice(0, 160) || "—"
            )}</td>
          </tr>`;
        })
        .join("");
    }
    if (eventsEmpty) eventsEmpty.hidden = events.length > 0;
  }

  function renderCarts(carts) {
    const body = $("#carts-body");
    const empty = $("#carts-empty");
    if (!body) return;

    if (!carts.length) {
      body.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    body.innerHTML = carts
      .map(
        (cart) => `<tr>
          <td>${escapeHTML(formatDate(cart.updated_at))}</td>
          <td><span class="items-summary">${itemsSummary(cart.items)} · ${itemsCount(
          cart.items
        )} u.</span></td>
          <td><strong>${formatMoney(cart.subtotal)}</strong></td>
          <td>${cart.step === "checkout" ? "Checkout" : "Carrito"}</td>
          <td>${statusBadge(cart.display_status)}</td>
        </tr>`
      )
      .join("");
  }

  const cartsStatus = $("#carts-status");
  if (cartsStatus) {
    cartsStatus.addEventListener("change", loadCarts);
  }

  /* ------------------------------- Detail ------------------------------- */

  const logoUrlCache = new Map();

  async function signedLogoUrl(path) {
    if (!path) return "";
    if (logoUrlCache.has(path)) return logoUrlCache.get(path);
    const { data, error } = await client.storage
      .from("order-logos")
      .createSignedUrl(path, 3600);
    const url = !error && data?.signedUrl ? data.signedUrl : "";
    logoUrlCache.set(path, url);
    return url;
  }

  const printUrlCache = new Map();

  async function signedPrintUrl(path) {
    if (!path) return "";
    if (printUrlCache.has(path)) return printUrlCache.get(path);
    const { data, error } = await client.storage
      .from("order-prints")
      .createSignedUrl(path, 3600);
    const url = !error && data?.signedUrl ? data.signedUrl : "";
    printUrlCache.set(path, url);
    return url;
  }

  const PRINT_LABELS = {
    queued: "Print en cola",
    cutout: "Preparando print",
    cutout_ready: "Preparando print",
    resizing: "Preparando print",
    ready: "Print listo",
    review: "Print a revisar",
    failed: "Print falló",
  };

  async function printAssetFor(design) {
    if (!design) return null;
    if (design.printPath) {
      return {
        path: design.printPath,
        dpi: Number(design.printDpi) || null,
        status: design.printStatus || "ready",
      };
    }
    const id = String(design.logoAssetId || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data, error } = await client
      .from("logo_assets")
      .select("print_path, output_dpi, status")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      path: data.print_path || "",
      dpi: Number(data.output_dpi) || null,
      status: data.status || "queued",
    };
  }

  async function printLink(design, side) {
    const asset = await printAssetFor(design);
    if (!asset) return "";
    const label = PRINT_LABELS[asset.status] || "Print";
    const url = await signedPrintUrl(asset.path);
    if (!url) {
      const id = String(design.logoAssetId || "");
      const retry = /^[0-9a-f-]{36}$/i.test(id)
        ? `<button type="button" class="print-retry" data-reprocess="${escapeHTML(
            id
          )}">Reprocesar</button>`
        : "";
      return `<span class="print-badge" data-state="${escapeHTML(
        asset.status
      )}">${escapeHTML(label)}</span>${retry}`;
    }
    const dpi = asset.dpi ? ` · ${asset.dpi} DPI` : "";
    return `<a class="logo-link logo-link--print" href="${escapeHTML(
      url
    )}" target="_blank" rel="noopener" download="print-${side.toLowerCase()}.png">Descargar print ${side}${escapeHTML(
      dpi
    )}</a>`;
  }

  const AREAS = {
    hoodie: { x: 24, y: 15, w: 52, h: 44 },
    tote: { x: 12, y: 36, w: 76, h: 48 },
  };

  function coordText(x, y) {
    const fx = Number.isFinite(Number(x)) ? Number(x) : 50;
    const fy = Number.isFinite(Number(y)) ? Number(y) : 50;
    const fmt = (value) => String(Math.round(value * 10) / 10).replace(".", ",");
    return `X ${fmt(fx)} % · Y ${fmt(fy)} %`;
  }

  function placementStatus(x, y, product) {
    const area = AREAS[product] || AREAS.hoodie;
    const px = Number.isFinite(Number(x)) ? Number(x) : 50;
    const py = Number.isFinite(Number(y)) ? Number(y) : 50;
    const inside =
      px >= area.x &&
      px <= area.x + area.w &&
      py >= area.y &&
      py <= area.y + area.h;
    const fmt = (value) => String(Math.round(value * 10) / 10).replace(".", ",");

    if (!inside) {
      return { text: "Fuera del área de impresión", outside: true };
    }

    const dx = px - (area.x + area.w / 2);
    const dy = py - (area.y + area.h / 2);
    const horizontal =
      Math.abs(dx) < 0.6
        ? "centrado"
        : `${fmt(Math.abs(dx))} % a la ${dx > 0 ? "derecha" : "izquierda"}`;
    const vertical =
      Math.abs(dy) < 0.6
        ? "centrado"
        : `${fmt(Math.abs(dy))} % ${dy > 0 ? "abajo" : "arriba"}`;
    return { text: `Dentro del área · ${horizontal} · ${vertical}`, outside: false };
  }

  function designMeta(item, side) {
    const design = (item && item[side]) || {};
    const text = String(design.text || "").trim();
    const hasLogo = Boolean(
      design.logoName || design.logoData || design.logoPath
    );
    if (!text && !hasLogo) return "";

    const rows = [];
    if (hasLogo) {
      const status = placementStatus(design.logoX, design.logoY, item?.product);
      rows.push(
        `<span class="design-meta__row"><b>Logo</b> ${coordText(
          design.logoX,
          design.logoY
        )} · ${Math.round((Number(design.logoScale) || 1) * 100)} %${
          Number(design.logoRotate)
            ? ` · ${Math.round(Number(design.logoRotate))}°`
            : ""
        }</span>`,
        `<span class="design-meta__status ${
          status.outside ? "is-bad" : "is-ok"
        }">${status.text}</span>`
      );
    }
    if (text) {
      rows.push(
        `<span class="design-meta__row"><b>Texto</b> ${coordText(
          design.textX,
          design.textY
        )} · ${Math.round((Number(design.textScale) || 1) * 100)} %${
          Number(design.textRotate)
            ? ` · ${Math.round(Number(design.textRotate))}°`
            : ""
        }</span>`
      );
    }
    return `<div class="design-meta">${rows.join("")}</div>`;
  }

  function designFont(id) {
    const fonts = {
      bricolage: "'Bricolage Grotesque', system-ui, sans-serif",
      anton: "Anton, Impact, sans-serif",
      archivo: "'Archivo Black', 'Arial Black', sans-serif",
      bebas: "'Bebas Neue', 'Arial Narrow', sans-serif",
      playfair: "'Playfair Display', Georgia, serif",
      bungee: "Bungee, 'Arial Black', sans-serif",
      caveat: "Caveat, 'Comic Sans MS', cursive",
    };
    return fonts[id] || fonts.bricolage;
  }

  /* Solo colores hex: nunca se interpola texto libre en un atributo style. */
  function safeHex(value, fallback) {
    const clean = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(clean) ? clean : fallback;
  }

  /* Contorno legible sobre el color de relleno del texto. */
  function outlineHex(value) {
    const clean = String(safeHex(value, "#fffdf8")).slice(1);
    const red = parseInt(clean.slice(0, 2), 16);
    const green = parseInt(clean.slice(2, 4), 16);
    const blue = parseInt(clean.slice(4, 6), 16);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    return luminance > 0.58 ? "#1c1c1f" : "#fffdf8";
  }

  /* Prenda con el diseño guardado en el pedido (frente o espalda). */
  function designShot(item, side, logoUrl, extraClass = "") {
    const design = (item && item[side]) || {};
    const isTote = item && item.product === "tote";
    const image = `assets/${isTote ? "tote" : "hoodie"}-${side}${
      isTote ? ".svg" : ".webp"
    }`;
    const text = String(design.text || "").trim();
    const color = safeHex(item?.colorHex, "#1c1c1f");
    const tx = Number(design.textX);
    const ty = Number(design.textY);
    const lx = Number(design.logoX);
    const ly = Number(design.logoY);
    const textHidden = Boolean(design.textHidden);
    const logoHidden = Boolean(design.logoHidden);
    const layerOrder =
      Array.isArray(design.layerOrder) && design.layerOrder.length
        ? design.layerOrder
        : ["text", "logo"];
    const textOnTop = layerOrder.indexOf("text") > layerOrder.indexOf("logo");

    const textEffect = ["outline", "shadow"].includes(design.textEffect)
      ? design.textEffect
      : "none";

    const textStyle = [
      `left:${Number.isFinite(tx) ? tx : 50}%`,
      `top:${Number.isFinite(ty) ? ty : 49}%`,
      `z-index:${textOnTop ? 4 : 2}`,
      `--tx-scale:${Number(design.textScale) || 1}`,
      `--tx-rot:${Number(design.textRotate) || 0}deg`,
      `color:${safeHex(design.textColor, "#fffdf8")}`,
      `font-family:${designFont(design.textFont)}`,
      textEffect === "outline"
        ? `-webkit-text-stroke:1px ${outlineHex(design.textColor)};paint-order:stroke fill`
        : "",
      textEffect === "shadow"
        ? "text-shadow:0.06em 0.075em 0.01em rgba(0,0,0,0.45)"
        : "",
    ]
      .filter(Boolean)
      .join(";");

    const logoStyle = [
      `left:${Number.isFinite(lx) ? lx : 50}%`,
      `top:${Number.isFinite(ly) ? ly : 32}%`,
      `z-index:${textOnTop ? 2 : 4}`,
      `--lg-scale:${Number(design.logoScale) || 1}`,
      `--lg-rot:${Number(design.logoRotate) || 0}deg`,
    ].join(";");

    const hasLogo = Boolean(
      design.logoName || design.logoData || design.logoPath
    );
    let logoSrc = logoUrl || "";
    let logoAttr = "";
    if (!logoSrc && design.logoPath) {
      logoAttr = ` data-logo-path="${escapeHTML(design.logoPath)}"`;
    } else if (
      !logoSrc &&
      typeof design.logoData === "string" &&
      /^data:image\//.test(design.logoData)
    ) {
      logoSrc = design.logoData;
    }

    return `<figure class="design-shot ${extraClass}" style="--fabric:${escapeHTML(
      color
    )}">
      <span class="design-tint" style="mask-image:url('${image}');-webkit-mask-image:url('${image}')"></span>
      <img class="design-photo" src="${image}" alt="">
      <span class="design-print">
        ${
          text && !textHidden
            ? `<span class="design-text" style="${textStyle}">${escapeHTML(
                text
              )}</span>`
            : ""
        }
        ${
          hasLogo && !logoHidden
            ? `<img class="design-logo" alt="" style="${logoStyle}" ${
                logoSrc ? `src="${escapeHTML(logoSrc)}"` : ""
              }${logoAttr}>`
            : ""
        }
      </span>
      <figcaption>${side === "front" ? "Frente" : "Espalda"}</figcaption>
    </figure>`;
  }

  async function hydrateLogoImages(root) {
    const images = [...root.querySelectorAll("img[data-logo-path]")];
    for (const image of images) {
      const path = image.dataset.logoPath;
      if (!path) continue;
      const url = await signedLogoUrl(path);
      if (url) image.src = url;
    }
  }

  async function logoLink(design, side) {    if (!design) return "";
    if (design.logoPath) {
      const { data, error } = await client.storage
        .from("order-logos")
        .createSignedUrl(design.logoPath, 3600);
      if (!error && data?.signedUrl) {
        return `<a class="logo-link" href="${escapeHTML(
          data.signedUrl
        )}" target="_blank" rel="noopener">Ver logo ${side}</a>`;
      }
    }
    if (
      typeof design.logoData === "string" &&
      /^data:image\/(png|jpeg|webp);base64,/.test(design.logoData)
    ) {
      return `<a class="logo-link" href="${escapeHTML(
        design.logoData
      )}" download="logo-${side.toLowerCase()}.png">Descargar logo ${side}</a>`;
    }
    return "";
  }

  async function orderItemsHtml(items) {
    return (
      await Promise.all(
        items.map(async (item) => {
          const frontUrl = await signedLogoUrl(item.front?.logoPath);
          const backUrl = await signedLogoUrl(item.back?.logoPath);
          const frontLink = await logoLink(item.front, "frente");
          const backLink = await logoLink(item.back, "espalda");
          const frontPrint = await printLink(item.front, "frente");
          const backPrint = await printLink(item.back, "espalda");
          const frontData =
            typeof item.front?.logoData === "string" &&
            /^data:image\//.test(item.front.logoData)
              ? item.front.logoData
              : "";
          const backData =
            typeof item.back?.logoData === "string" &&
            /^data:image\//.test(item.back.logoData)
              ? item.back.logoData
              : "";
          const frontSrc = frontUrl || frontData;
          const backSrc = backUrl || backData;

          const logoItems = [];
          if (frontSrc || item.front?.logoName) {
            logoItems.push(
              `<span class="detail-logo-item">${
                frontSrc
                  ? `<img class="detail-logo-thumb" src="${escapeHTML(
                      frontSrc
                    )}" alt="Logo frente">`
                  : ""
              }<span class="detail-logo-name">Logo frente${
                item.front?.logoName
                  ? ` · ${escapeHTML(item.front.logoName)}`
                  : ""
              }</span>${frontLink}${frontPrint}</span>`
            );
          }
          if (backSrc || item.back?.logoName) {
            logoItems.push(
              `<span class="detail-logo-item">${
                backSrc
                  ? `<img class="detail-logo-thumb" src="${escapeHTML(
                      backSrc
                    )}" alt="Logo espalda">`
                  : ""
              }<span class="detail-logo-name">Logo espalda${
                item.back?.logoName
                  ? ` · ${escapeHTML(item.back.logoName)}`
                  : ""
              }</span>${backLink}${backPrint}</span>`
            );
          }
          const logos = logoItems.join("");

          const roster = item.rosterName || item.rosterNumber
            ? ` · Equipo: ${escapeHTML(item.rosterName || "Sin nombre")}${
                item.rosterNumber ? ` #${escapeHTML(item.rosterNumber)}` : ""
              }`
            : "";
          return `<li>
            <div class="detail-item-main">
              <span>${escapeHTML(item.name || "Sudadera")} · ${escapeHTML(
            item.colorName || ""
          )} · Talla ${escapeHTML(item.size || "—")} · ${escapeHTML(
            item.materialName || ""
          )} · ${escapeHTML(item.techniqueName || "")} · x${escapeHTML(item.qty)}${roster}</span>
              <strong>${formatMoney((Number(item.unitPrice) || 0) * (Number(item.qty) || 0))}</strong>
            </div>
            <div class="design-previews">
              <div class="design-figure">
                ${designShot(item, "front", frontUrl)}
                ${designMeta(item, "front")}
              </div>
              <div class="design-figure">
                ${designShot(item, "back", backUrl)}
                ${designMeta(item, "back")}
              </div>
            </div>
            ${logos ? `<span class="detail-logos">${logos}</span>` : ""}
          </li>`;
        })
      )
    ).join("");
  }

  async function openOrder(id) {
    const { data: order, error } = await client
      .from("orders")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !order) {
      toast("No se pudo abrir el pedido.");
      return;
    }

    const detail = $("#order-detail");
    if (!detail) return;

    const items = Array.isArray(order.items) ? order.items : [];
    detail.innerHTML = `
      <h2 id="order-modal-title">Pedido LH-${escapeHTML(order.number)}</h2>
      <p class="modal-sub">${escapeHTML(formatDate(order.created_at))} · ${statusBadge(
      order.status
    )}</p>
      <div class="detail-grid">
        <div><span>Cliente</span><strong>${escapeHTML(
          order.customer_name
        )}</strong></div>
        <div><span>Email</span><strong>${escapeHTML(order.email)}</strong></div>
        <div><span>Teléfono</span><strong>${escapeHTML(order.phone || "—")}</strong></div>
        <div><span>Ciudad / Estado / CP</span><strong>${escapeHTML(
          [order.city, order.state, order.zip].filter(Boolean).join(" · ") || "-"
        )}</strong></div>
        <div><span>Dirección</span><strong>${escapeHTML(order.address || "-")}</strong></div>
        ${
          order.address_ref
            ? `<div><span>Referencias</span><strong>${escapeHTML(
                order.address_ref
              )}</strong></div>`
            : ""
        }
        <div><span>Pago</span><strong>${escapeHTML(
          order.payment_method === "clip" ? "Clip" : "Demostración"
        )} · ${escapeHTML(
          PAYMENT_LABELS[order.payment_status] || order.payment_status || "—"
        )}</strong></div>
        ${
          order.payment_reference
            ? `<div><span>Referencia de pago</span><strong>${escapeHTML(
                order.payment_reference
              )}</strong></div>`
            : ""
        }
        ${
          order.paid_at
            ? `<div><span>Pagado</span><strong>${escapeHTML(
                formatDate(order.paid_at)
              )}</strong></div>`
            : ""
        }
      </div>
      <ul class="detail-items">
        ${await orderItemsHtml(items)}
      </ul>
      <div class="detail-total"><span>Total</span><strong>${formatMoney(
        order.total
      )}</strong></div>
      <div class="modal-actions">
        <label for="detail-status">Estado del pedido</label>
        <select id="detail-status">
          ${Object.entries(STATUS_LABELS)
            .map(
              ([value, label]) =>
                `<option value="${value}" ${
                  value === order.status ? "selected" : ""
                }>${label}</option>`
            )
            .join("")}
        </select>
        <label for="detail-approval">Aprobación del diseño</label>
        <select id="detail-approval">
          ${Object.entries(APPROVAL_LABELS)
            .map(
              ([value, label]) =>
                `<option value="${value}" ${
                  value === (order.design_approval_status || "pending")
                    ? "selected"
                    : ""
                }>${label}</option>`
            )
            .join("")}
        </select>
        <label for="detail-notes">Notas internas</label>
        <textarea id="detail-notes" placeholder="Producción, entrega o incidencias…">${escapeHTML(
          order.admin_notes || ""
        )}</textarea>
        <label for="detail-carrier">Paquetería</label>
        <input id="detail-carrier" type="text" maxlength="60" placeholder="Estafeta, DHL, FedEx…" value="${escapeHTML(
          order.carrier || ""
        )}">
        <label for="detail-tracking">Número de guía</label>
        <input id="detail-tracking" type="text" maxlength="80" placeholder="1234567890" value="${escapeHTML(
          order.tracking_number || ""
        )}">
        <label for="detail-tracking-url">URL de seguimiento</label>
        <input id="detail-tracking-url" type="url" maxlength="300" placeholder="https://…" value="${escapeHTML(
          order.tracking_url || ""
        )}">
        <button class="btn btn-dark" type="button" id="detail-save">Guardar cambios</button>
      </div>
    `;

    const modal = $("#order-modal");
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    modal.removeAttribute("inert");

    $("#detail-save").addEventListener("click", async () => {
      const status = $("#detail-status").value;
      const approval = $("#detail-approval").value;
      const adminNotes = $("#detail-notes").value.slice(0, 1000);
      const carrier = $("#detail-carrier").value.trim().slice(0, 60);
      const trackingNumber = $("#detail-tracking").value.trim().slice(0, 80);
      const trackingUrl = $("#detail-tracking-url").value.trim().slice(0, 300);
      if (trackingUrl && !/^https:\/\//i.test(trackingUrl)) {
        toast("La URL de seguimiento debe empezar por https://");
        return;
      }
      const { error: updateError } = await client
        .from("orders")
        .update({
          status,
          design_approval_status: approval,
          design_approved_at:
            approval === "approved"
              ? order.design_approved_at || new Date().toISOString()
              : null,
          admin_notes: adminNotes,
          carrier: carrier || null,
          tracking_number: trackingNumber || null,
          tracking_url: trackingUrl || null,
        })
        .eq("id", order.id);
      if (updateError) {
        toast("No se pudieron guardar los cambios.");
        return;
      }
      toast("Pedido actualizado.");
      closeOrderModal();
      loadOrders();
      loadStats();
    });
  }

  function closeOrderModal() {
    const modal = $("#order-modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("inert", "");
  }

  $$("[data-close-order]").forEach((button) =>
    button.addEventListener("click", closeOrderModal)
  );

  const orderModal = $("#order-modal");
  if (orderModal) {
    orderModal.addEventListener("click", (event) => {
      if (event.target === orderModal) closeOrderModal();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOrderModal();
  });

  /* -------------------------------- CSV --------------------------------- */

  function csvCell(value) {
    let text = String(value == null ? "" : value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCSV(filename, rows) {
    const blob = new Blob(["\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function exportOrders() {
    let query = client.from("orders").select("*").order("created_at", { ascending: false }).limit(1000);
    query = orderFilters(query);
    const { data, error } = await query;
    if (error) {
      toast("No se pudo exportar.");
      return;
    }
    const rows = [
      ["Pedido", "Fecha", "Estado del pedido", "Pago", "Cliente", "Email", "Teléfono", "Dirección", "Referencias", "Ciudad", "Estado (envío)", "CP", "Artículos", "Subtotal", "Envío", "Total", "Paquetería", "Guía", "Seguimiento", "Notas"],
      ...(data || []).map((order) => [
        `LH-${order.number}`,
        order.created_at,
        STATUS_LABELS[order.status] || order.status,
        PAYMENT_LABELS[order.payment_status] || order.payment_status || "",
        order.customer_name,
        order.email,
        order.phone || "",
        order.address || "",
        order.address_ref || "",
        order.city || "",
        order.state || "",
        order.zip || "",
        itemsSummary(order.items),
        order.subtotal,
        order.shipping,
        order.total,
        order.carrier || "",
        order.tracking_number || "",
        order.tracking_url || "",
        order.admin_notes || "",
      ]),
    ];
    downloadCSV(`pedidos-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  async function exportCarts() {
    const filter = $("#carts-status")?.value || "";
    const filtered = filter
      ? cartsCache.filter((cart) => cart.display_status === filter)
      : cartsCache;
    const rows = [
      ["Última actividad", "Estado", "Paso", "Artículos", "Unidades", "Valor", "Detalle"],
      ...filtered.map((cart) => [
        cart.updated_at,
        cart.display_status,
        cart.step,
        itemsSummary(cart.items),
        itemsCount(cart.items),
        cart.subtotal,
        Array.isArray(cart.items)
          ? cart.items
              .map(
                (item) =>
                  `${item.name || "Sudadera"} ${item.colorName || ""} ${
                    item.size || ""
                  } x${item.qty || 1}`
              )
              .join(" | ")
          : "",
      ]),
    ];
    downloadCSV(`carritos-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  const exportOrdersButton = $("#export-orders");
  if (exportOrdersButton) exportOrdersButton.addEventListener("click", exportOrders);
  const exportCartsButton = $("#export-carts");
  if (exportCartsButton) exportCartsButton.addEventListener("click", exportCarts);

  init();
})();
