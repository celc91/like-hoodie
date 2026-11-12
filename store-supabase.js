// like hoodie ♡ — sincronización de carritos y pedidos con Supabase
// La publishable key es pública; las políticas RLS limitan el acceso.
(() => {
  const config = window.LIKEHOODIE_SUPABASE || {};
  const configured =
    typeof config.url === "string" &&
    typeof config.publishableKey === "string" &&
    config.url.startsWith("https://") &&
    !config.url.includes("TU-PROYECTO") &&
    config.publishableKey.length > 40 &&
    !config.publishableKey.includes("TU_PUBLISHABLE");

  const CART_KEY = "likehoodie_cart_id_v1";
  const sdkAvailable = Boolean(
    window.supabase && typeof window.supabase.createClient === "function"
  );
  const enabled = configured && sdkAvailable;
  let client = null;
  let user = null;
  let cartId = null;
  let ready = false;
  let initPromise = null;
  let syncTimer = null;
  let pendingSync = null;
  let justOrdered = false;
  let configCache = null;

  function safeDesign(design) {
    if (!design) return null;
    return {
      text: String(design.text || "").slice(0, 40),
      textColor: design.textColor || null,
      textScale: Number(design.textScale) || 1,
      textFont: design.textFont || "bricolage",
      logoName: String(design.logoName || "").slice(0, 160),
      logoPath: String(design.logoPath || "").slice(0, 300),
      logoData:
        typeof design.logoData === "string" &&
        /^data:image\/(png|jpeg|webp);base64,/.test(design.logoData)
          ? design.logoData.slice(0, 1_800_000)
          : "",
      logoScale: Number(design.logoScale) || 1,
      textX: Number(design.textX) || 50,
      textY: Number(design.textY) || 49,
      logoX: Number(design.logoX) || 50,
      logoY: Number(design.logoY) || 32,
    };
  }

  const MATERIAL_IDS_BY_NAME = {
    "Algodón 400 g": "cotton400",
    "Algodón 320 g": "cotton320",
    "French terry 300 g": "french300",
    "French terry": "french300",
    "Mezcla 50/50": "blend350",
    "Poliéster técnico": "polyester280",
  };

  const TECHNIQUE_IDS_BY_NAME = {
    DTG: "dtg",
    DTF: "dtf",
    Bordado: "bordado",
    Serigrafía: "serigrafia",
    "Vinilo textil": "vinilo",
    Sublimación: "sublimacion",
  };

  function safeItems(items) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, 50).map((item) => ({
      name: String(item.name || "Sudadera personalizada").slice(0, 120),
      qty: Math.max(1, Math.min(99, Number(item.qty) || 1)),
      unitPrice: Math.max(0, Number(item.unitPrice) || 0),
      colorHex: /^#[0-9a-f]{6}$/i.test(String(item.colorHex || ""))
        ? String(item.colorHex).toLowerCase()
        : "",
      colorName: item.colorName || "",
      size: item.size || "",
      materialId:
        item.materialId ||
        MATERIAL_IDS_BY_NAME[item.materialName] ||
        "",
      materialName: item.materialName || "",
      techniqueId:
        item.techniqueId ||
        TECHNIQUE_IDS_BY_NAME[item.techniqueName] ||
        "",
      techniqueName: item.techniqueName || "",
      front: safeDesign(item.front),
      back: safeDesign(item.back),
    }));
  }

  function cartTotals(items) {
    const subtotal = items.reduce(
      (sum, item) => sum + item.unitPrice * item.qty,
      0
    );
    return {
      itemCount: items.reduce((sum, item) => sum + item.qty, 0),
      subtotal,
    };
  }

  async function ensure() {
    if (!enabled) return false;
    if (!client) {
      client = window.supabase.createClient(config.url, config.publishableKey, {
        auth: {
          storageKey: "likehoodie-store-auth",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    if (ready) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const { data } = await client.auth.getSession();
      if (data?.session?.user) {
        user = data.session.user;
      } else {
        const { data: signIn, error } = await client.auth.signInAnonymously();
        if (error) throw error;
        user = signIn.user;
      }
      try {
        cartId = window.localStorage.getItem(CART_KEY);
      } catch (error) {
        cartId = null;
      }
      ready = true;
      return true;
    })().catch((error) => {
      console.warn("No se pudo iniciar la analítica de Supabase.", error);
      ready = false;
      return false;
    });

    return initPromise;
  }

  async function findCart() {
    if (!user) return null;
    if (cartId) {
      const { data } = await client
        .from("carts")
        .select("id, status")
        .eq("id", cartId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (data && data.status !== "converted") return data.id;
      cartId = null;
    }

    const { data } = await client
      .from("carts")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["open", "empty"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.id) {
      cartId = data.id;
      return cartId;
    }
    return null;
  }

  async function saveCart(items, step = "cart") {
    if (!(await ensure())) return;

    try {
      const clean = safeItems(items);
      const { itemCount, subtotal } = cartTotals(clean);
      if (itemCount > 0) justOrdered = false;
      if (itemCount === 0 && justOrdered) return;
      const currentId = await findCart();
      if (itemCount === 0 && !currentId) return;
      const payload = {
        user_id: user.id,
        items: clean,
        item_count: itemCount,
        subtotal,
        currency: "MXN",
        step: step === "checkout" ? "checkout" : "cart",
        status: itemCount > 0 ? "open" : "empty",
      };

      if (currentId) {
        const { error } = await client
          .from("carts")
          .update(payload)
          .eq("id", currentId)
          .eq("user_id", user.id);
        if (error) {
          cartId = null;
        }
        return;
      }

      const { data, error } = await client
        .from("carts")
        .insert(payload)
        .select("id")
        .single();

      if (!error && data?.id) {
        cartId = data.id;
        try {
          window.localStorage.setItem(CART_KEY, cartId);
        } catch (error) {
          /* Sin almacenamiento local, el carrito sigue en esta sesión. */
        }
      }
    } catch (error) {
      console.warn("No se pudo sincronizar el carrito.", error);
    }
  }

  function syncCart(items, step = "cart") {
    pendingSync = { items, step };
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      const next = pendingSync;
      pendingSync = null;
      if (next) saveCart(next.items, next.step);
    }, 700);
  }

  async function track(name, metadata = {}) {
    if (!(await ensure())) return;
    try {
      await client.from("events").insert({
        user_id: user.id,
        name: String(name).slice(0, 60),
        path: String(window.location.pathname).slice(0, 180),
        metadata,
      });
    } catch (error) {
      /* Los eventos no deben bloquear la tienda. */
    }
  }

  // Meta CAPI: el servidor solo envía la compra de quien aceptó publicidad.
  // La decisión se guarda en la base de datos, no en el navegador.
  function adsAllowed() {
    try {
      const api = window.LikeHoodieConsent;
      const state = api && typeof api.get === "function" ? api.get() : null;
      return Boolean(state && state.ads);
    } catch (error) {
      return false;
    }
  }

  async function setAdConsent(granted) {
    if (!(await ensure())) return false;
    try {
      const { error } = await client.rpc("set_ad_consent", {
        p_granted: Boolean(granted),
      });
      return !error;
    } catch (error) {
      return false;
    }
  }

  document.addEventListener("likehoodie:consent", function (event) {
    const ads = Boolean(event.detail && event.detail.ads);
    setAdConsent(ads);
  });

  function cancelPendingSync() {
    if (syncTimer) {
      window.clearTimeout(syncTimer);
      syncTimer = null;
    }
    pendingSync = null;
  }

  async function uploadLogo(file, side = "front") {
    if (!(await ensure())) return null;
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      return null;
    }
    if (file.size > 5 * 1024 * 1024) return null;

    const extension =
      file.type === "image/jpeg"
        ? "jpg"
        : file.type === "image/webp"
          ? "webp"
          : "png";
    const safeSide = side === "back" ? "back" : "front";
    const path = `${user.id}/${safeSide}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${extension}`;

    try {
      const { error } = await client.storage
        .from("order-logos")
        .upload(path, file, {
          contentType: file.type,
          cacheControl: "3600",
          upsert: false,
        });
      if (error) {
        console.warn("No se pudo subir el logo a Storage.", error.message);
        return null;
      }
      return path;
    } catch (error) {
      console.warn("No se pudo subir el logo a Storage.", error);
      return null;
    }
  }

  async function placeOrder(order) {
    if (!(await ensure())) return null;
    cancelPendingSync();

    try {
      const items = safeItems(order.items);
      const { itemCount } = cartTotals(items);
      await saveCart(items, "checkout");
      await findCart();

      const row = {
        name: String(order.customer?.name || "").trim(),
        email: String(order.customer?.email || "").trim(),
        phone: String(order.customer?.phone || "").trim(),
        address: String(order.customer?.address || "").trim(),
        city: String(order.customer?.city || "").trim(),
        zip: String(order.customer?.zip || "").trim(),
      };

      // Deja registrado el permiso de publicidad justo antes de crear el pedido,
      // por si la decisión se tomó en otra pestaña o en una visita anterior.
      await setAdConsent(adsAllowed());

      const { data, error } = await client.rpc("place_order", {
        p_customer: row,
        p_items: items,
        p_cart_id: cartId || null,
        p_notes: String(order.notes || "").slice(0, 500),
        p_coupon: order.coupon ? String(order.coupon).slice(0, 32) : null,
      });

      if (error || !data) {
        console.warn("No se pudo guardar el pedido.", error);
        return null;
      }

      const result = data;
      cancelPendingSync();
      cartId = null;
      justOrdered = true;
      try {
        window.localStorage.removeItem(CART_KEY);
      } catch (error) {
        /* Ignorar. */
      }

      track("order_created", {
        number: result.number,
        total: order.total,
        item_count: itemCount,
      });

      if (window.LikeHoodieConsent && typeof window.LikeHoodieConsent.track === "function") {
        window.LikeHoodieConsent.track(
          "order_created",
          {
            value: order.total,
            currency: "MXN",
            transaction_id: result.number,
          },
          { eventId: "lh-" + result.number }
        );
      }

      return {
        id: result.id,
        number: result.number,
        paymentMethod: result.payment_method || "demo",
        paymentStatus: result.payment_status || "demo",
      };
    } catch (error) {
      console.warn("No se pudo guardar el pedido.", error);
      return null;
    }
  }

  async function getConfig() {
    if (configCache) return configCache;
    if (!(await ensure())) {
      return { payment_provider: "demo" };
    }

    try {
      const { data, error } = await client.rpc("store_config");
      configCache =
        !error && data && typeof data === "object"
          ? data
          : { payment_provider: "demo" };
    } catch (error) {
      configCache = { payment_provider: "demo" };
    }
    return configCache;
  }

  async function createClipCheckout(orderId) {
    if (!(await ensure())) {
      throw new Error("La tienda no está configurada.");
    }

    const { data, error } = await client.functions.invoke("clip-checkout", {
      body: { orderId: String(orderId || "") },
    });

    if (error) {
      let message = "No se pudo abrir el pago con Clip.";
      try {
        const payload = await error.context?.json();
        if (payload?.error) message = payload.error;
      } catch (parseError) {
        /* Usar el mensaje genérico. */
      }
      throw new Error(message);
    }

    return data && typeof data === "object" ? data : { enabled: false };
  }

  async function payClipOrder(orderId, token, customer) {
    if (!(await ensure())) {
      throw new Error("La tienda no está configurada.");
    }

    const { data, error } = await client.functions.invoke("clip-pay", {
      body: {
        orderId: String(orderId || ""),
        token: String(token || ""),
        customer: {
          email: String(customer?.email || ""),
          phone: String(customer?.phone || ""),
        },
      },
    });

    if (error) {
      let message = "No se pudo procesar el pago con Clip.";
      try {
        const payload = await error.context?.json();
        if (payload?.error) message = payload.error;
      } catch (parseError) {
        /* Usar el mensaje genérico. */
      }
      throw new Error(message);
    }

    return data && typeof data === "object" ? data : { status: "error" };
  }

  async function getOrderPayment(number) {    const value = Number(String(number == null ? "" : number).replace(/\D/g, ""));
    if (!Number.isInteger(value) || value <= 0) return null;
    if (!(await ensure())) return null;

    try {
      const { data, error } = await client
        .from("orders")
        .select("number,payment_method,payment_status,paid_at")
        .eq("number", value)
        .maybeSingle();
      if (error) return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  async function init() {
    const ok = await ensure();
    if (ok) {
      track("page_view");
    }
    return ok;
  }

  // Alta en la lista del Club like hoodie
  async function subscribeNewsletter(email) {
    const clean = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
      return { ok: false, reason: "invalid" };
    }

    const ok = await ensure();
    if (!ok) return { ok: false, reason: "offline" };

    // vía nueva: función con límite por IP
    const { data, error } = await client.rpc("subscribe_newsletter", { p_email: clean });

    if (!error && data) {
      if (!data.ok) return { ok: false, reason: data.reason || "error" };
      return { ok: true, duplicate: Boolean(data.duplicate), sent: Boolean(data.sent) };
    }

    // compatibilidad mientras no se haya ejecutado antispam.sql
    if (error && error.code !== "PGRST202" && error.code !== "42883") {
      console.error("No se pudo guardar el correo:", error);
      return { ok: false, reason: error.code || "error" };
    }

    const { error: insertError } = await client
      .from("newsletter_subscribers")
      .insert({ email: clean, source: "web" });

    if (!insertError) return { ok: true };
    if (insertError.code === "23505") return { ok: true, duplicate: true };

    console.error("No se pudo guardar el correo:", insertError);
    return { ok: false, reason: insertError.code || "error" };
  }

  // Devuelve el descuento de un cupón si es válido.
  // La tabla no es legible desde el navegador: se consulta por función.
  async function findCoupon(code) {
    const clean = String(code || "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,32}$/.test(clean)) return { ok: false, reason: "invalid" };

    const ok = await ensure();
    if (!ok) return { ok: false, reason: "offline" };

    // vía nueva: función del servidor (no expone la tabla)
    const { data, error } = await client.rpc("check_coupon", { p_code: clean });

    if (!error && data) {
      if (!data.valid) {
        return { ok: false, reason: data.reason || "notfound" };
      }
      return { ok: true, code: data.code, percent: Number(data.percent) };
    }

    // compatibilidad mientras no se haya ejecutado security-fixes.sql
    if (error && error.code !== "PGRST202" && error.code !== "42883") {
      console.error("No se pudo validar el cupón:", error);
      return { ok: false, reason: "error" };
    }

    const { data: row, error: rowError } = await client
      .from("coupons")
      .select("code,percent,active,max_uses,used_count,expires_at")
      .eq("code", clean)
      .maybeSingle();

    if (rowError) {
      console.error("No se pudo validar el cupón:", rowError);
      return { ok: false, reason: "error" };
    }
    if (!row || !row.active) return { ok: false, reason: "notfound" };
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: "expired" };
    }
    if (row.max_uses && row.used_count >= row.max_uses) {
      return { ok: false, reason: "exhausted" };
    }

    return { ok: true, code: row.code, percent: Number(row.percent) };
  }

  window.StoreSupabase = {
    configured: enabled,
    init,
    syncCart,
    track,
    uploadLogo,
    placeOrder,
    getConfig,
    createClipCheckout,
    payClipOrder,
    getOrderPayment,
    subscribeNewsletter,
    findCoupon,
    setAdConsent,
  };
})();
