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
        setLoginError(
          error.message === "Invalid login credentials"
            ? "Correo o contraseña incorrectos."
            : error.message
        );
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
            <td><strong>${formatMoney(order.total)}</strong></td>
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

    const pageLabel = $("#orders-page");
    if (pageLabel) {
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
        <div><span>Ciudad / CP</span><strong>${escapeHTML(
          [order.city, order.zip].filter(Boolean).join(" · ") || "—"
        )}</strong></div>
        <div><span>Dirección</span><strong>${escapeHTML(order.address || "—")}</strong></div>
        <div><span>Pago</span><strong>${escapeHTML(order.payment_method || "—")} · ${
          order.payment_status === "demo" ? "demo" : escapeHTML(order.payment_status || "—")
        }</strong></div>
      </div>
      <ul class="detail-items">
        ${items
          .map(
            (item) => `<li>
              <span>${escapeHTML(item.name || "Sudadera")} · ${escapeHTML(
              item.colorName || ""
            )} · Talla ${escapeHTML(item.size || "—")} · ${escapeHTML(
              item.materialName || ""
            )} · ${escapeHTML(item.techniqueName || "")} · x${escapeHTML(item.qty)}</span>
              <strong>${formatMoney((Number(item.unitPrice) || 0) * (Number(item.qty) || 0))}</strong>
            </li>`
          )
          .join("")}
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
    return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
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
      ["Pedido", "Fecha", "Estado", "Cliente", "Email", "Teléfono", "Dirección", "Ciudad", "CP", "Artículos", "Subtotal", "Envío", "Total", "Notas"],
      ...(data || []).map((order) => [
        `LH-${order.number}`,
        order.created_at,
        STATUS_LABELS[order.status] || order.status,
        order.customer_name,
        order.email,
        order.phone || "",
        order.address || "",
        order.city || "",
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
