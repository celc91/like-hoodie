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
  const loginError = $("#login-error");
  const loginButton = $("#login-button");
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

  function showLogin() {
    appView.hidden = true;
    loginView.hidden = false;
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
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

  async function startSession(user) {
    currentUser = user;
    const admin = await checkAdmin(user);
    if (!admin) {
      await client.auth.signOut();
      currentUser = null;
      setLoginError("Esta cuenta no tiene permisos de administrador.");
      showLogin();
      return;
    }
    showApp();
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

    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        storageKey: "likehoodie-admin-auth",
        persistSession: true,
        autoRefreshToken: true,
      },
    });

    const { data } = await client.auth.getSession();
    if (data?.session?.user) {
      await startSession(data.session.user);
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

      await startSession(authData.user);
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
      if (section === "pedidos") loadOrders();
      if (section === "carritos") loadCarts();
    });
  });

  const refreshButton = $("#refresh-button");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      loadAll();
      toast("Datos actualizados.");
    });
  }

  function loadAll() {
    loadStats();
    loadOrders();
    loadCarts();
  }

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
    };
    return fonts[id] || fonts.bricolage;
  }

  /* Solo colores hex: nunca se interpola texto libre en un atributo style. */
  function safeHex(value, fallback) {
    const clean = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(clean) ? clean : fallback;
  }

  /* Prenda con el diseño guardado en el pedido (frente o espalda). */
  function designShot(item, side, logoUrl, extraClass = "") {
    const design = (item && item[side]) || {};
    const isTote = item && item.product === "tote";
    const image = `assets/${isTote ? "tote" : "hoodie"}-${side}${
      isTote ? ".svg" : ".png"
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

    const textStyle = [
      `left:${Number.isFinite(tx) ? tx : 50}%`,
      `top:${Number.isFinite(ty) ? ty : 49}%`,
      `z-index:${textOnTop ? 4 : 2}`,
      `--tx-scale:${Number(design.textScale) || 1}`,
      `--tx-rot:${Number(design.textRotate) || 0}deg`,
      `color:${safeHex(design.textColor, "#fffdf8")}`,
      `font-family:${designFont(design.textFont)}`,
    ].join(";");

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

          return `<li>
            <div class="detail-item-main">
              <span>${escapeHTML(item.name || "Sudadera")} · ${escapeHTML(
            item.colorName || ""
          )} · Talla ${escapeHTML(item.size || "—")} · ${escapeHTML(
            item.materialName || ""
          )} · ${escapeHTML(item.techniqueName || "")} · x${escapeHTML(item.qty)}</span>
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
        <label for="detail-notes">Notas internas</label>
        <textarea id="detail-notes" placeholder="Producción, entrega o incidencias…">${escapeHTML(
          order.admin_notes || ""
        )}</textarea>
        <button class="btn btn-dark" type="button" id="detail-save">Guardar cambios</button>
      </div>
    `;

    const modal = $("#order-modal");
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    $("#detail-save").addEventListener("click", async () => {
      const status = $("#detail-status").value;
      const adminNotes = $("#detail-notes").value.slice(0, 1000);
      const { error: updateError } = await client
        .from("orders")
        .update({ status, admin_notes: adminNotes })
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
      ["Pedido", "Fecha", "Estado del pedido", "Pago", "Cliente", "Email", "Teléfono", "Dirección", "Referencias", "Ciudad", "Estado (envío)", "CP", "Artículos", "Subtotal", "Envío", "Total", "Notas"],
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
