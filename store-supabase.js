// like hoodie ♡ — sincronización de carritos y pedidos con Supabase
// La anon key es pública; las políticas RLS limitan el acceso.
(() => {
  const config = window.LIKEHOODIE_SUPABASE || {};
  const configured =
    typeof config.url === "string" &&
    typeof config.anonKey === "string" &&
    config.url.startsWith("https://") &&
    !config.url.includes("TU-PROYECTO") &&
    config.anonKey.length > 40 &&
    !config.anonKey.includes("TU_ANON");

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

  function safeDesign(design) {
    if (!design) return null;
    return {
      text: String(design.text || "").slice(0, 40),
      textColor: design.textColor || null,
      textScale: Number(design.textScale) || 1,
      textFont: design.textFont || "bricolage",
      logoName: design.logoName || "",
      logoScale: Number(design.logoScale) || 1,
      textX: Number(design.textX) || 50,
      textY: Number(design.textY) || 49,
      logoX: Number(design.logoX) || 50,
      logoY: Number(design.logoY) || 32,
    };
  }

  function safeItems(items) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, 50).map((item) => ({
      name: String(item.name || "Sudadera personalizada").slice(0, 120),
      qty: Math.max(1, Math.min(99, Number(item.qty) || 1)),
      unitPrice: Math.max(0, Number(item.unitPrice) || 0),
      colorName: item.colorName || "",
      size: item.size || "",
      materialName: item.materialName || "",
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
      client = window.supabase.createClient(config.url, config.anonKey, {
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

  async function placeOrder(order) {
    if (!(await ensure())) return null;

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

      const { data, error } = await client.rpc("place_order", {
        p_customer: row,
        p_items: items,
        p_cart_id: cartId || null,
        p_notes: String(order.notes || "").slice(0, 500),
      });

      if (error || !data) {
        console.warn("No se pudo guardar el pedido.", error);
        return null;
      }

      const result = data;
      cartId = null;
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

      return { id: result.id, number: result.number };
    } catch (error) {
      console.warn("No se pudo guardar el pedido.", error);
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

  window.StoreSupabase = {
    configured: enabled,
    init,
    syncCart,
    track,
    placeOrder,
  };
})();
