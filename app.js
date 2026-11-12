/* ==========================================================================
   like hoodie ♡ — Lógica de tienda (carrito, configurador y checkout de demo)
   ========================================================================== */

(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const money = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  });

  const formatPrice = (value) => `$${money.format(Math.round(value))} MXN`;

  const FREE_SHIPPING = 1200;
  const SHIPPING_COST = 99;
  const LOGO_PRICE = 99;
  const XXL_PRICE = 49;
  const STORAGE_KEY = "likehoodie_cart_v1";
  const LEGACY_STORAGE_KEY = "chama_cart_v1";

  const BASE_PRICES = {
    "#1c1c1f": 899,
    "#efe6d6": 949,
    "#cdf25a": 969,
    "#f2603c": 949,
    "#26324f": 899,
    "#efb7c4": 899,
  };

  const DEFAULT_POSITIONS = {
    front: { textX: 50, textY: 49, logoX: 50, logoY: 32 },
    back: { textX: 50, textY: 49, logoX: 50, logoY: 32 },
  };

  const MATERIAL_IDS = [
    "cotton400",
    "cotton320",
    "french300",
    "blend350",
    "polyester280",
  ];

  const TECHNIQUE_IDS = [
    "dtg",
    "dtf",
    "bordado",
    "serigrafia",
    "vinilo",
    "sublimacion",
  ];

  const TEXT_FONTS = {
    bricolage: {
      name: "Bricolage",
      className: "font-bricolage",
    },
    anton: {
      name: "Anton",
      className: "font-anton",
    },
    archivo: {
      name: "Archivo Black",
      className: "font-archivo",
    },
    bebas: {
      name: "Bebas Neue",
      className: "font-bebas",
    },
    playfair: {
      name: "Playfair Display",
      className: "font-playfair",
    },
  };

  const state = {
    color: "#1c1c1f",
    colorName: "Negro",
    basePrice: 899,
    size: "M",
    view: "front",
    angle: 0,
    cartStep: "cart",
    coupon: null,
    material: {
      id: "cotton400",
      name: "Algodón 400 g",
      delta: 0,
      desc: "Algodón peinado 400 g/m²: grueso, abrigador y con caída premium.",
    },
    technique: {
      id: "dtg",
      name: "DTG",
      price: 0,
      desc: "Impresión directa al tejido, full color. Ideal para algodón.",
    },
    designs: {
      front: {
        text: "",
        textColor: "#fffdf8",
        textScale: 1,
        textFont: "bricolage",
        logo: null,
        logoName: "",
        logoPath: "",
        logoData: "",
        logoScale: 1,
        ...DEFAULT_POSITIONS.front,
      },
      back: {
        text: "",
        textColor: "#fffdf8",
        textScale: 1,
        textFont: "bricolage",
        logo: null,
        logoName: "",
        logoPath: "",
        logoData: "",
        logoScale: 1,
        ...DEFAULT_POSITIONS.back,
      },
    },
    items: loadCart(),
  };

  /* ---------------------------------------------------------------------- */
  /* Utilidades                                                              */
  /* ---------------------------------------------------------------------- */

  function loadCart() {
    try {
      const raw =
        window.localStorage.getItem(STORAGE_KEY) ||
        window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.unitPrice === "number" &&
          Number.isFinite(item.unitPrice) &&
          typeof item.qty === "number" &&
          item.qty > 0
      );
    } catch (error) {
      return [];
    }
  }

  function saveCart() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
    } catch (error) {
      /* El carrito sigue funcionando en memoria. */
    }
    window.StoreSupabase?.syncCart(state.items, state.cartStep || "cart");
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
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

  function safeColor(value) {
    return /^#[0-9a-f]{3,8}$/i.test(value || "") ? value : "#1c1c1f";
  }

  function contrastFor(hex) {
    const clean = safeColor(hex).replace("#", "");
    const full =
      clean.length === 3
        ? clean.split("").map((character) => character + character).join("")
        : clean;
    const red = parseInt(full.slice(0, 2), 16);
    const green = parseInt(full.slice(2, 4), 16);
    const blue = parseInt(full.slice(4, 6), 16);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    return luminance > 0.58 ? "#1c1c1f" : "#fffdf8";
  }

  function totals() {
    const subtotal = state.items.reduce(
      (sum, item) => sum + item.unitPrice * item.qty,
      0
    );
    const discount = state.coupon
      ? Math.min(subtotal, Math.round((subtotal * state.coupon.percent) / 100))
      : 0;
    const shipping =
      subtotal === 0 || subtotal >= FREE_SHIPPING ? 0 : SHIPPING_COST;
    return { subtotal, discount, shipping, total: Math.max(0, subtotal - discount + shipping) };
  }

  function activeDesign() {
    return state.designs[state.view];
  }

  function logoCount() {
    return Object.values(state.designs).filter((design) => design.logo).length;
  }

  function hasAnyDesign() {
    return Object.values(state.designs).some(
      (design) => design.text.length > 0 || Boolean(design.logo)
    );
  }

  function techniqueFee() {
    return hasAnyDesign() ? state.technique.price : 0;
  }

  function clampPosition(value, type = "text", axis = "x") {
    if (axis === "x") {
      const min = type === "text" ? 23 : 15;
      const max = type === "text" ? 77 : 85;
      return Math.max(min, Math.min(max, value));
    }
    return Math.max(10, Math.min(90, value));
  }

  /* ---------------------------------------------------------------------- */
  /* Referencias DOM                                                         */
  /* ---------------------------------------------------------------------- */

  const header = $("[data-header]");
  const menuToggle = $("[data-menu-toggle]");
  const mobileMenu = $("[data-mobile-menu]");
  const overlay = $("[data-overlay]");
  const cartDrawer = $("[data-cart-drawer]");
  const cartCount = $("[data-cart-count]");
  const cartItems = $("[data-cart-items]");
  const cartEmpty = $("[data-cart-empty]");
  const cartFoot = $("[data-cart-foot]");
  const shippingBar = $("[data-shipping-bar]");
  const shippingMessage = $("[data-shipping-message]");
  const shippingProgress = $("[data-shipping-progress]");
  const subtotalEl = $("[data-subtotal]");
  const shippingEl = $("[data-shipping]");
  const totalEl = $("[data-total]");
  const checkoutButton = $("[data-checkout]");
  const closeCartButtons = $$("[data-close-cart]");

  const checkoutModal = $("[data-checkout-modal]");
  const checkoutFormView = $("[data-checkout-form-view]");
  const checkoutSuccess = $("[data-checkout-success]");
  const checkoutForm = $("[data-checkout-form]");
  const checkoutTotal = $("[data-checkout-total]");
  const orderNumber = $("[data-order-number]");
  const checkoutNote = $("[data-checkout-note]");
  const checkoutSuccessTitle = $("[data-checkout-success-title]");
  const checkoutSuccessMessage = $("[data-checkout-success-message]");
  const retryPaymentButton = $("[data-retry-payment]");
  const paymentBanner = $("[data-payment-banner]");
  const paymentBannerTitle = $("[data-payment-banner-title]");
  const paymentBannerText = $("[data-payment-banner-text]");
  const closePaymentBanner = $("[data-close-payment-banner]");

  const sizeModal = $("[data-size-modal]");

  const hoodiePreview = $("[data-preview-hoodie]");
  const hoodiePhoto = $("[data-hoodie-photo]");
  const previewNames = $$("[data-preview-color-name]");
  const previewSwatch = $("[data-preview-swatch]");
  const previewSize = $("[data-preview-size]");
  const previewMaterial = $("[data-preview-material]");
  const previewTechnique = $("[data-preview-technique]");
  const printText = $("[data-print-text]");
  const printLogo = $("[data-print-logo]");
  const viewButtons = $$(".view-tab");
  const viewThumbs = $$("[data-angle]");
  const hintText = $("[data-hint-text]");
  const studio = $(".studio");
  const personalizePanel = $(".personalize");
  const toolButtons = $$("[data-personalize-tool]");
  const toolPanels = $$("[data-personalize-panel]");
  const editingLabel = $("[data-editing-label]");
  const resetPrintButton = $("[data-reset-print]");
  const colorSwatches = $$(".swatch[data-color]");
  const sizeButtons = $$(".size");
  const textInput = $("[data-text-input]");
  const charCount = $("[data-char-count]");
  const textSizeInput = $("[data-text-size]");
  const textSizeValue = $("[data-text-size-value]");
  const logoSizeInput = $("[data-logo-size]");
  const logoSizeValue = $("[data-logo-size-value]");
  const textColorButtons = $$("[data-text-color]");
  const fontButtons = $$("[data-text-font]");
  const optionTooltip = $("[data-option-tooltip]");
  const tooltipTitle = $("[data-tooltip-title]");
  const tooltipDesc = $("[data-tooltip-desc]");
  const materialButtons = $$("[data-material]");
  const materialLabel = $("[data-material-label]");
  const materialNote = $("[data-material-note]");
  const techniqueButtons = $$("[data-technique]");
  const techniqueLabel = $("[data-technique-label]");
  const techniqueNote = $("[data-technique-note]");
  const techniqueWarning = $("[data-technique-warning]");
  const logoInput = $("[data-logo-input]");
  const uploadFile = $("[data-upload-file]");
  const fileName = $("[data-file-name]");
  const removeLogoButton = $("[data-remove-logo]");
  const priceEl = $("[data-price-display]");
  const priceNote = $("[data-price-note]");
  const priceMirrorEl = $("[data-price-mirror]");
  const addMirrorButton = $("[data-add-mirror]");
  const couponInput = $("[data-coupon-input]");
  const couponApply = $("[data-coupon-apply]");
  const couponNote = $("[data-coupon-note]");
  const couponLine = $("[data-coupon-line]");
  const couponValue = $("[data-coupon-value]");
  const couponLabel = $("[data-coupon-label]");
  const checkoutCoupon = $("[data-checkout-coupon]");
  const addToCartButton = $("[data-add-to-cart]");
  const personalizeButtons = $$("[data-personalize]");
  const newsletterForms = $$("[data-newsletter]");
  const toastRegion = $("[data-toast-region]");

  let lastFocusedElement = null;
  let paymentProvider = "demo";
  let lastPendingOrder = null;
  let paymentPollTimer = null;

  /* ---------------------------------------------------------------------- */
  /* Toasts                                                                  */
  /* ---------------------------------------------------------------------- */

  function showToast(message) {
    if (!toastRegion) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastRegion.appendChild(toast);
    window.requestAnimationFrame(() => toast.classList.add("is-visible"));
    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 320);
    }, 2800);
  }

  /* ---------------------------------------------------------------------- */
  /* Cesta                                                                   */
  /* ---------------------------------------------------------------------- */

  /* Miniatura real del diseño: canvas con la prenda y el estampado */
  const THUMB_HOODIE = new Image();
  THUMB_HOODIE.src = "assets/hoodie-front.png";
  const thumbCache = new Map();
  THUMB_HOODIE.addEventListener("load", () => {
    thumbCache.clear();
    if (state.items && state.items.length) renderCart();
  });

  const THUMB_FONTS = {
    bricolage: { family: "Bricolage Grotesque", weight: 800 },
    anton: { family: "Anton", weight: 400 },
    archivo: { family: "Archivo Black", weight: 400 },
    bebas: { family: "Bebas Neue", weight: 400 },
    playfair: { family: "Playfair Display", weight: 700 },
  };

  function thumbWrap(ctx, text, maxWidth) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [text];
  }

  function makeThumb(front, colorHex, isDark) {
    if (!THUMB_HOODIE.complete || !THUMB_HOODIE.naturalWidth) return "";
    if (!front || !front.text) return "";

    const W = 240;
    const H = Math.round((W * THUMB_HOODIE.naturalHeight) / THUMB_HOODIE.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    if (isDark) {
      ctx.filter = "brightness(0.27) contrast(1.06)";
      ctx.drawImage(THUMB_HOODIE, 0, 0, W, H);
      ctx.filter = "none";
    } else {
      ctx.drawImage(THUMB_HOODIE, 0, 0, W, H);
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = colorHex;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.35;
      ctx.drawImage(THUMB_HOODIE, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    const cx = ((front.textX ?? 50) / 100) * W;
    const cy = ((front.textY ?? 49) / 100) * H;
    const scale = front.textScale || 1;
    const rotation = ((front.textRotate || 0) * Math.PI) / 180;
    const cfg = THUMB_FONTS[front.textFont] || THUMB_FONTS.bricolage;
    const size = W * 0.082;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);
    ctx.font = cfg.weight + " " + size + 'px "' + cfg.family + '", sans-serif';
    ctx.fillStyle = front.textColor || "#fffdf9";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) ctx.letterSpacing = (size * 0.02).toFixed(2) + "px";

    const lines = thumbWrap(ctx, front.text.toUpperCase(), W * 0.42);
    const lineHeight = size * 0.9;
    const startY = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, 0, startY + i * lineHeight));
    ctx.restore();

    return canvas.toDataURL("image/png");
  }

  /* Cupones ---------------------------------------------------------------- */

  const COUPON_KEY = "likehoodie.coupon";

  function loadStoredCoupon() {
    try {
      const raw = localStorage.getItem(COUPON_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.code || !parsed.percent) return null;
      return { code: String(parsed.code), percent: Number(parsed.percent) };
    } catch (error) {
      return null;
    }
  }

  function storeCoupon(coupon) {
    try {
      if (coupon) {
        localStorage.setItem(COUPON_KEY, JSON.stringify({ code: coupon.code, percent: coupon.percent }));
      } else {
        localStorage.removeItem(COUPON_KEY);
      }
    } catch (error) {
      /* almacenamiento no disponible */
    }
  }

  function setCouponNote(text, isError = false) {
    if (!couponNote) return;
    couponNote.textContent = text || "";
    couponNote.hidden = !text;
    couponNote.classList.toggle("is-error", Boolean(isError));
  }

  async function applyCoupon() {
    const code = (couponInput && couponInput.value ? couponInput.value : "").trim();
    if (!code) return;

    if (!window.StoreSupabase || typeof window.StoreSupabase.findCoupon !== "function") {
      setCouponNote("No pudimos validar el código. Inténtalo más tarde.", true);
      return;
    }

    if (couponApply) {
      couponApply.disabled = true;
      couponApply.textContent = "…";
    }

    const result = await window.StoreSupabase.findCoupon(code);

    if (couponApply) {
      couponApply.disabled = false;
      couponApply.textContent = state.coupon ? "Quitar" : "Aplicar";
    }

    if (!result.ok) {
      const messages = {
        notfound: "Ese código no existe.",
        expired: "Ese código ya caducó.",
        exhausted: "Ese código ya no tiene usos disponibles.",
        offline: "Sin conexión. Inténtalo de nuevo.",
        invalid: "Escribe un código válido.",
      };
      setCouponNote(messages[result.reason] || "No pudimos validar el código.", true);
      return;
    }

    state.coupon = { code: result.code, percent: result.percent, verified: true };
    storeCoupon(state.coupon);
    setCouponNote("");
    renderCart();
    showToast(`Cupón ${result.code} aplicado: −${result.percent} %`);
  }

  function removeCoupon() {
    state.coupon = null;
    storeCoupon(null);
    if (couponInput) couponInput.value = "";
    setCouponNote("");
    renderCart();
    showToast("Cupón quitado.");
  }

  // Si el cupón venía guardado de otra visita, se vuelve a validar
  async function revalidateCoupon() {
    if (!state.coupon || state.coupon.verified) return;
    if (!window.StoreSupabase || typeof window.StoreSupabase.findCoupon !== "function") return;
    const result = await window.StoreSupabase.findCoupon(state.coupon.code);
    if (!result.ok) {
      state.coupon = null;
      storeCoupon(null);
      setCouponNote("Ese cupón ya no es válido.", true);
    } else {
      state.coupon = { code: result.code, percent: result.percent, verified: true };
      storeCoupon(state.coupon);
    }
    renderCart();
  }

  state.coupon = loadStoredCoupon();

  function renderCart() {
    const count = state.items.reduce((sum, item) => sum + item.qty, 0);
    const { subtotal, discount, shipping, total } = totals();

    if (cartCount) {
      cartCount.textContent = String(count);
      cartCount.classList.toggle("has-items", count > 0);
    }

    if (!cartItems) return;

    const scrollTop = cartItems.scrollTop;

    if (count === 0) {
      cartItems.innerHTML = "";
      cartItems.hidden = true;
      cartEmpty.hidden = false;
      cartFoot.hidden = true;
      shippingBar.hidden = true;
      return;
    }

    cartItems.hidden = false;
    cartEmpty.hidden = true;
    cartFoot.hidden = false;
    shippingBar.hidden = false;

    cartItems.innerHTML = state.items
      .map((item) => {
        const color = safeColor(item.colorHex);
        const front = item.front || {
          text: item.text || "",
          logoName: item.logoName || "",
        };
        const back = item.back || {};
        const isDark = color.toLowerCase() === "#1c1c1f";
        const thumbKey = item.key || item.id;
        let thumbSrc = thumbCache.get(thumbKey);
        if (!thumbSrc) {
          thumbSrc = makeThumb(front, color, isDark);
          if (thumbSrc) thumbCache.set(thumbKey, thumbSrc);
        }
        const scaleLabel = (scale) => {
          const percent = Math.round((scale || 1) * 100);
          return percent === 100 ? "" : ` (${percent}%)`;
        };
        const textMeta = (design) => {
          const parts = [];
          const font = TEXT_FONTS[design.textFont];
          if (font && design.textFont !== "bricolage") parts.push(font.name);
          const percent = Math.round((design.textScale || 1) * 100);
          if (percent !== 100) parts.push(`${percent}%`);
          return parts.length ? ` (${parts.join(", ")})` : "";
        };
        const customLines = [];
        customLines.push(`Material: ${item.materialName || "Algodón 400 g"}`);
        customLines.push(`Técnica: ${item.techniqueName || "DTG"}`);
        if (front.text) {
          customLines.push(`Frente: “${front.text}”${textMeta(front)}`);
        }
        if (front.logoName) {
          customLines.push(
            `Logo frente: ${front.logoName}${scaleLabel(front.logoScale)}`
          );
        }
        if (back.text) {
          customLines.push(`Espalda: “${back.text}”${textMeta(back)}`);
        }
        if (back.logoName) {
          customLines.push(
            `Logo espalda: ${back.logoName}${scaleLabel(back.logoScale)}`
          );
        }
        const customHTML = customLines
          .map((line) => `<p class="cart-custom">${escapeHTML(line)}</p>`)
          .join("");
        return `
          <article class="cart-item" data-id="${escapeHTML(item.id)}">
            <div class="cart-thumb" aria-hidden="true">
              ${thumbSrc ? `<img class="cart-thumb-img" src="${thumbSrc}" alt="">` : `<div class="hoodie ${isDark ? "is-dark" : ""}" style="--fabric-color:${color};--tint-mask:url('assets/hoodie-front.png')">
                ${isDark ? "" : '<div class="fabric-tint"></div>'}
                <img class="hoodie-photo" src="assets/hoodie-front.png" alt="" width="1003" height="1229" loading="lazy">
                <div class="print-area print-area--thumb">
                  ${front.text ? `<span class="print-text editor-item font-${escapeHTML(front.textFont || "bricolage")}" style="--x:${front.textX}%;--y:${front.textY}%;--item-scale:${front.textScale || 1};--item-rotate:${front.textRotate || 0}deg;color:${escapeHTML(front.textColor || "#fffdf9")}">${escapeHTML(front.text)}</span>` : ""}
                  ${front.logoData ? `<img class="print-logo editor-item" src="${front.logoData}" alt="" style="--x:${front.logoX}%;--y:${front.logoY}%;--item-scale:${front.logoScale || 1};--item-rotate:${front.logoRotate || 0}deg">` : ""}
                </div>
              </div>`}
            </div>
            <div class="cart-info">
              <div class="cart-item-top">
                <h3>${escapeHTML(item.name || "Sudadera personalizada")}</h3>
                <button type="button" class="remove" data-remove-item="${escapeHTML(item.id)}" aria-label="Quitar ${escapeHTML(item.name || "sudadera")} de la cesta">×</button>
              </div>
              <p class="cart-meta">${escapeHTML(item.colorName || "Negro")} · Talla ${escapeHTML(item.size || "M")}</p>
              ${customHTML}
              <div class="cart-item-bottom">
                <div class="qty" role="group" aria-label="Cantidad de ${escapeHTML(item.name || "sudadera")}">
                  <button type="button" data-dec="${escapeHTML(item.id)}" aria-label="Quitar una unidad">−</button>
                  <span>${item.qty}</span>
                  <button type="button" data-inc="${escapeHTML(item.id)}" aria-label="Añadir una unidad">+</button>
                </div>
                <strong>${formatPrice(item.unitPrice * item.qty)}</strong>
              </div>
            </div>
          </article>`;
      })
      .join("");

    cartItems.scrollTop = scrollTop;

    subtotalEl.textContent = formatPrice(subtotal);
    shippingEl.textContent = shipping === 0 ? "Gratis" : formatPrice(shipping);
    totalEl.textContent = formatPrice(total);

    // cupón
    if (couponApply) {
      couponApply.textContent = state.coupon ? "Quitar" : "Aplicar";
    }
    if (couponInput) {
      couponInput.value = state.coupon ? state.coupon.code : "";
      couponInput.disabled = Boolean(state.coupon);
    }
    if (couponLine) {
      couponLine.hidden = !state.coupon || discount <= 0;
      if (state.coupon && couponLabel && couponValue) {
        couponLabel.textContent = `Descuento ${state.coupon.code} (−${state.coupon.percent} %)`;
        couponValue.textContent = "−" + formatPrice(discount);
      }
    }

    const missing = Math.max(0, FREE_SHIPPING - subtotal);
    if (missing <= 0) {
      shippingMessage.textContent = "¡Enhorabuena! Tienes envío gratis.";
    } else {
      shippingMessage.textContent = `Te faltan ${formatPrice(missing)} para el envío gratis.`;
    }
    const progress = Math.min(100, (subtotal / FREE_SHIPPING) * 100);
    shippingProgress.style.width = `${progress}%`;

    checkoutTotal.textContent = formatPrice(total);
  }

  function openCart() {
    closeMenu();
    lastFocusedElement = document.activeElement;
    renderCart();
    revalidateCoupon();
    cartDrawer.style.removeProperty("transform");
    if (overlay) overlay.style.removeProperty("opacity");
    cartDrawer.classList.add("is-open");
    overlay.classList.add("is-open");
    cartDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
    const closeButton = $("[data-close-cart]", cartDrawer);
    if (closeButton) {
      window.setTimeout(() => closeButton.focus({ preventScroll: true }), 80);
    }
  }

  function closeCart(returnFocus = true) {
    cartDrawer.classList.remove("is-open");
    overlay.classList.remove("is-open");
    cartDrawer.setAttribute("aria-hidden", "true");
    if (!checkoutModal.classList.contains("is-open") && !sizeModal.classList.contains("is-open")) {
      document.body.classList.remove("is-locked");
    }
    if (returnFocus && lastFocusedElement && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus({ preventScroll: true });
    }
  }

  function changeQuantity(id, delta) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
      state.items = state.items.filter((entry) => entry.id !== id);
    }
    saveCart();
    renderCart();

    if (cartCount) {
      cartCount.classList.remove("is-pulsing");
      void cartCount.offsetWidth;
      cartCount.classList.add("is-pulsing");
    }
  }

  if (cartItems) {
    cartItems.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-item]");
      if (remove) {
        state.items = state.items.filter((item) => item.id !== remove.dataset.removeItem);
        saveCart();
        renderCart();
        return;
      }

      const increment = event.target.closest("[data-inc]");
      if (increment) {
        changeQuantity(increment.dataset.inc, 1);
        return;
      }

      const decrement = event.target.closest("[data-dec]");
      if (decrement) {
        changeQuantity(decrement.dataset.dec, -1);
      }
    });
  }

  const openCartButtons = $$("[data-open-cart]");
  openCartButtons.forEach((button) => button.addEventListener("click", openCart));
  closeCartButtons.forEach((button) => button.addEventListener("click", () => closeCart()));
  if (overlay) overlay.addEventListener("click", () => closeCart());

  if (couponApply) {
    couponApply.addEventListener("click", () => {
      if (state.coupon) removeCoupon();
      else applyCoupon();
    });
  }

  if (couponInput) {
    couponInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyCoupon();
    });
  }

  /* ---------------------------------------------------------------------
     Panel de la cesta: arrastre 1:1, goma elástica, proyección de impulso
     y spring crítico con traspaso de velocidad.
     --------------------------------------------------------------------- */
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  function projectMomentum(velocity, deceleration = 0.998) {
    return ((velocity / 1000) * deceleration) / (1 - deceleration);
  }

  // Spring crítico (sin rebote). Devuelve una función para cancelarlo.
  function runSpring(from, to, initialVelocity, onFrame, onDone) {
    const response = 0.34; // segundos
    const damping = 1;     // crítico
    const omega = (2 * Math.PI) / response;
    let value = from;
    let velocity = initialVelocity;
    let last = performance.now();
    let frame = 0;

    function step(now) {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const acceleration = -omega * omega * (value - to) - 2 * damping * omega * velocity;
      velocity += acceleration * dt;
      value += velocity * dt;

      if (Math.abs(value - to) < 0.4 && Math.abs(velocity) < 12) {
        onFrame(to);
        if (onDone) onDone();
        return;
      }

      onFrame(value);
      frame = requestAnimationFrame(step);
    }

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }

  if (cartDrawer) {
    let drag = null;
    let cancelSettle = null;
    let ignoreClick = false;
    let ignoreClickTimer = 0;

    const drawerWidth = () => cartDrawer.getBoundingClientRect().width || 1;
    const currentOffset = () => {
      const value = getComputedStyle(cartDrawer).transform;
      if (!value || value === "none") return 0;
      try {
        return new DOMMatrixReadOnly(value).m41 || 0;
      } catch (error) {
        return 0;
      }
    };

    cartDrawer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (!cartDrawer.classList.contains("is-open")) return;
      if (reduceMotionQuery.matches) return;

      const wasSettling = Boolean(cancelSettle);
      if (cancelSettle) {
        cancelSettle();
        cancelSettle = null;
      }
      // se retoma desde la posición real en pantalla (interrumpible)
      const live = currentOffset();
      cartDrawer.classList.remove("is-dragging");

      drag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        base: live,
        offset: 0,
        velocity: 0,
        lastTime: performance.now(),
        lastOffset: 0,
        tracking: false,
        settling: wasSettling,
      };
    });

    cartDrawer.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (!drag.tracking) {
        if (Math.hypot(dx, dy) < 10) return;
        // si el gesto es vertical, es scroll del contenido: soltamos
        if (Math.abs(dy) > Math.abs(dx)) {
          drag = null;
          return;
        }
        drag.tracking = true;
        drag.lastTime = performance.now();
        drag.lastOffset = drag.base;
        try {
          cartDrawer.setPointerCapture(event.pointerId);
        } catch (error) {
          /* puntero sintético o ya liberado */
        }
        cartDrawer.classList.add("is-dragging");
      }

      const width = drawerWidth();
      const raw = drag.base + dx;
      // goma elástica si se pasa hacia la izquierda
      const offset = raw < 0 ? raw * 0.25 : raw;
      drag.offset = Math.min(offset, width * 1.04);

      const now = performance.now();
      const dt = Math.max(now - drag.lastTime, 1);
      if (dt < 120) {
        const instant = ((drag.offset - drag.lastOffset) / dt) * 1000;
        // suavizado exponencial: pesa más el movimiento reciente
        drag.velocity = drag.velocity * 0.3 + instant * 0.7;
        drag.velocity = Math.max(-4000, Math.min(4000, drag.velocity));
      }
      drag.lastTime = now;
      drag.lastOffset = drag.offset;

      cartDrawer.style.transform = `translate3d(${drag.offset}px, 0, 0)`;
      if (overlay) {
        overlay.style.opacity = String(1 - Math.min(drag.offset / width, 1) * 0.65);
      }
    });

    // Lleva el panel a un destino con un spring crítico, desde la posición
    // real en pantalla y con la velocidad que traía el dedo.
    function settle(target, velocity, shouldClose) {
      const width = drawerWidth();
      cancelSettle = runSpring(
        currentOffset(),
        target,
        velocity,
        (value) => {
          cartDrawer.style.transform = `translate3d(${value}px, 0, 0)`;
          if (overlay) {
            overlay.style.opacity = String(1 - Math.min(value / width, 1) * 0.65);
          }
        },
        () => {
          cancelSettle = null;
          cartDrawer.classList.remove("is-dragging");
          if (shouldClose) closeCart();
          cartDrawer.style.removeProperty("transform");
          if (overlay) overlay.style.removeProperty("opacity");
        }
      );
    }

    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;

      if (!drag.tracking) {
        // fue un toque: si venía de un cierre a medias, vuelve a abrirse
        if (drag.settling) settle(0, 0, false);
        drag = null;
        return;
      }

      const width = drawerWidth();
      const from = drag.offset;
      const velocity = drag.velocity;
      const projected = from + projectMomentum(velocity);
      const shouldClose = projected > width * 0.42 || velocity > 520;

      drag = null;
      ignoreClick = true;
      window.clearTimeout(ignoreClickTimer);
      ignoreClickTimer = window.setTimeout(() => {
        ignoreClick = false;
      }, 350);

      settle(shouldClose ? width * 1.04 : 0, velocity, shouldClose);
    }

    cartDrawer.addEventListener("pointerup", endDrag);
    cartDrawer.addEventListener("pointercancel", endDrag);

    // un arrastre no debe disparar el click del elemento que quedó debajo
    cartDrawer.addEventListener(
      "click",
      (event) => {
        if (!ignoreClick) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Checkout                                                                */
  /* ---------------------------------------------------------------------- */

  function openCheckout() {
    if (state.items.length === 0) return;
    closeCart(false);
    lastFocusedElement = document.activeElement;
    checkoutForm.reset();
    checkoutFormView.hidden = false;
    checkoutSuccess.hidden = true;
    if (checkoutSuccessTitle) checkoutSuccessTitle.textContent = "¡Pedido confirmado!";
    if (checkoutSuccessMessage) {
      checkoutSuccessMessage.textContent =
        "Gracias por confiar en like hoodie ♡. Tu pedido quedó registrado como demostración; todavía no se realiza ningún cargo. Te contactaremos cuando se active el pago real.";
    }
    if (retryPaymentButton) retryPaymentButton.hidden = true;
    checkoutTotal.textContent = formatPrice(totals().total);
    if (checkoutCoupon) {
      const summary = totals();
      if (state.coupon && summary.discount > 0) {
        checkoutCoupon.textContent = `Incluye cupón ${state.coupon.code} (−${state.coupon.percent} %): −${formatPrice(summary.discount)}`;
        checkoutCoupon.hidden = false;
      } else {
        checkoutCoupon.hidden = true;
      }
    }
    checkoutModal.classList.add("is-open");
    checkoutModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
    state.cartStep = "checkout";
    saveCart();
    window.StoreSupabase?.track("begin_checkout", {
      total: totals().total,
      items: state.items.length,
    });
    window.setTimeout(() => {
      const firstField = $("#f-name");
      if (firstField) firstField.focus({ preventScroll: true });
    }, 120);
  }

  function closeCheckout() {
    checkoutModal.classList.remove("is-open");
    checkoutModal.setAttribute("aria-hidden", "true");
    if (!cartDrawer.classList.contains("is-open") && !sizeModal.classList.contains("is-open")) {
      document.body.classList.remove("is-locked");
    }
    if (lastFocusedElement && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus({ preventScroll: true });
    }
    window.setTimeout(() => {
      checkoutFormView.hidden = false;
      checkoutSuccess.hidden = true;
      checkoutForm.reset();
    }, 300);
  }

  if (checkoutButton) checkoutButton.addEventListener("click", openCheckout);

  $$("[data-close-checkout]").forEach((button) =>
    button.addEventListener("click", closeCheckout)
  );

  if (checkoutModal) {
    checkoutModal.addEventListener("click", (event) => {
      if (event.target === checkoutModal) closeCheckout();
    });
  }

  function showCheckoutResult(title, message, options = {}) {
    if (checkoutSuccessTitle) checkoutSuccessTitle.textContent = title;
    if (checkoutSuccessMessage) checkoutSuccessMessage.textContent = message;
    if (retryPaymentButton) retryPaymentButton.hidden = !options.retry;
    checkoutFormView.hidden = true;
    checkoutSuccess.hidden = false;
    checkoutSuccess.scrollIntoView({ block: "nearest" });
    if (options.focus !== false) {
      const focusTarget = $("[data-close-checkout]", checkoutSuccess);
      if (focusTarget) window.setTimeout(() => focusTarget.focus(), 120);
    }
  }

  function restoreSubmitButton(button) {
    if (!button) return;
    button.disabled = false;
    button.textContent = button.dataset.originalLabel || "Confirmar pedido";
  }

  if (checkoutForm) {
    checkoutForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!checkoutForm.checkValidity()) {
        checkoutForm.reportValidity();
        return;
      }

      const data = new FormData(checkoutForm);
      const customer = {
        name: String(data.get("name") || "").trim(),
        email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        address: String(data.get("address") || "").trim(),
        city: String(data.get("city") || "").trim(),
        zip: String(data.get("zip") || "").trim(),
      };
      const { subtotal, shipping, total } = totals();
      const analytics = window.StoreSupabase;
      const submitButton = checkoutForm.querySelector('button[type="submit"]');
      let orderLabel = "CH-" + Math.floor(10000 + Math.random() * 90000);
      let savedOrder = null;

      if (analytics?.configured) {
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.dataset.originalLabel = submitButton.textContent;
          submitButton.textContent = "Guardando pedido…";
        }

        const saved = await analytics.placeOrder({
          customer,
          items: state.items,
          subtotal,
          shipping,
          total,
          coupon: state.coupon ? state.coupon.code : null,
        });

        if (!saved) {
          restoreSubmitButton(submitButton);
          showToast(
            "No pudimos registrar el pedido. Revisa tu conexión e inténtalo de nuevo."
          );
          return;
        }

        savedOrder = saved;
        orderLabel = `LH-${saved.number}`;
        restoreSubmitButton(submitButton);

        state.items = [];
        state.cartStep = "cart";
        saveCart();
        renderCart();

        const needsPayment =
          saved.paymentStatus === "pending" || saved.paymentMethod === "clip";

        if (needsPayment) {
          lastPendingOrder = saved;
          if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Abriendo pago seguro…";
          }

          try {
            const checkout = await analytics.createClipCheckout(saved.id);

            if (checkout?.alreadyPaid) {
              orderNumber.textContent = orderLabel;
              showCheckoutResult(
                "Pago confirmado",
                "Recibimos tu pago. Tu pedido quedó confirmado y empezaremos a prepararlo."
              );
              showToast("Pago confirmado. ¡Gracias!");
              return;
            }

            if (checkout?.enabled && checkout.url) {
              window.location.assign(checkout.url);
              return;
            }

            orderNumber.textContent = orderLabel;
            showCheckoutResult(
              "Pedido registrado",
              "Tu pedido quedó guardado, pero el pago en línea todavía no está disponible. Escríbenos a hola@likehoodie.com para completarlo.",
              { retry: true }
            );
            showToast("El pago en línea no está disponible todavía.");
            return;
          } catch (error) {
            orderNumber.textContent = orderLabel;
            showCheckoutResult(
              "Pedido registrado",
              "No pudimos abrir la página de pago. Tu pedido quedó guardado; puedes reintentar el pago o escribirnos a hola@likehoodie.com.",
              { retry: true }
            );
            showToast(error?.message || "No se pudo abrir el pago.");
            return;
          } finally {
            restoreSubmitButton(submitButton);
          }
        }
      }

      if (!savedOrder) {
        state.items = [];
        state.cartStep = "cart";
        saveCart();
        renderCart();
      }

      orderNumber.textContent = orderLabel;
      showCheckoutResult(
        "¡Pedido confirmado!",
        analytics?.configured
          ? "Gracias por confiar en like hoodie ♡. Tu pedido quedó registrado como demostración; todavía no se realiza ningún cargo. Te contactaremos cuando se active el pago real."
          : "Gracias por confiar en like hoodie ♡. Tu pedido quedó registrado como demostración; todavía no se realiza ningún cargo."
      );
      showToast(
        analytics?.configured
          ? "Pedido confirmado. ¡Gracias!"
          : "Pedido de demostración confirmado. ¡Gracias!"
      );
    });
  }

  if (retryPaymentButton) {
    retryPaymentButton.addEventListener("click", async () => {
      if (!lastPendingOrder || !window.StoreSupabase?.configured) return;
      retryPaymentButton.disabled = true;
      retryPaymentButton.textContent = "Abriendo pago…";

      try {
        const checkout = await window.StoreSupabase.createClipCheckout(
          lastPendingOrder.id
        );

        if (checkout?.alreadyPaid) {
          showCheckoutResult(
            "Pago confirmado",
            "Recibimos tu pago. Tu pedido quedó confirmado y empezaremos a prepararlo."
          );
          return;
        }

        if (checkout?.enabled && checkout.url) {
          window.location.assign(checkout.url);
          return;
        }

        showToast("El pago todavía no está disponible. Inténtalo más tarde.");
      } catch (error) {
        showToast(error?.message || "No se pudo abrir el pago.");
      } finally {
        retryPaymentButton.disabled = false;
        retryPaymentButton.textContent = "Reintentar pago";
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Pagos con Clip                                                          */
  /* ---------------------------------------------------------------------- */

  async function loadPaymentConfig() {
    if (!window.StoreSupabase?.configured) return;

    try {
      const config = await window.StoreSupabase.getConfig();
      paymentProvider =
        config?.payment_provider === "clip" ? "clip" : "demo";
      if (checkoutNote) {
        checkoutNote.textContent =
          paymentProvider === "clip"
            ? "Al confirmar, te llevaremos a la página segura de Clip para completar el pago."
            : "Pedido de demostración: no se realizará ningún cargo real.";
      }
    } catch (error) {
      paymentProvider = "demo";
    }
  }

  function setPaymentBanner(state, title, text) {
    if (!paymentBanner) return;
    paymentBanner.hidden = false;
    paymentBanner.classList.remove("is-success", "is-error", "is-pending");
    if (state === "success") paymentBanner.classList.add("is-success");
    else if (state === "error") paymentBanner.classList.add("is-error");
    else paymentBanner.classList.add("is-pending");
    if (paymentBannerTitle) paymentBannerTitle.textContent = title;
    if (paymentBannerText) paymentBannerText.textContent = text;
  }

  function dismissPaymentBanner() {
    if (paymentBanner) paymentBanner.hidden = true;
    if (paymentPollTimer) {
      window.clearTimeout(paymentPollTimer);
      paymentPollTimer = null;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("pago");
    url.searchParams.delete("pedido");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  async function pollPaymentStatus(number, attempt = 0) {
    if (!window.StoreSupabase?.configured) return;

    const order = await window.StoreSupabase.getOrderPayment(number);
    if (order) {
      if (order.payment_status === "paid") {
        setPaymentBanner(
          "success",
          "Pago confirmado",
          "Recibimos tu pago. Tu pedido quedó confirmado y empezaremos a prepararlo."
        );
        return;
      }
      if (
        order.payment_status === "failed" ||
        order.payment_status === "cancelled"
      ) {
        setPaymentBanner(
          "error",
          "Pago no completado",
          "El cargo no se completó. Puedes volver a intentarlo desde la tienda."
        );
        return;
      }
    }

    if (attempt >= 6) {
      setPaymentBanner(
        "pending",
        "Pago en revisión",
        "Si ya pagaste, te confirmaremos por correo en cuanto Clip procese el pago."
      );
      return;
    }

    paymentPollTimer = window.setTimeout(
      () => pollPaymentStatus(number, attempt + 1),
      5000
    );
  }

  function initPaymentBanner() {
    const params = new URLSearchParams(window.location.search);
    const stateParam = params.get("pago");
    if (!stateParam) return;

    const number = params.get("pedido") || "";
    const label = number ? ` · ${number}` : "";

    if (stateParam === "exito") {
      setPaymentBanner(
        "pending",
        "Pago recibido",
        `Estamos confirmando tu pago con Clip${label}. Esto puede tardar unos segundos.`
      );
      if (number) pollPaymentStatus(number);
      return;
    }

    if (stateParam === "error") {
      setPaymentBanner(
        "error",
        "Pago no completado",
        "No se realizó el cargo. Puedes volver a intentarlo desde la tienda."
      );
      return;
    }

    setPaymentBanner(
      "pending",
      "Pago pendiente",
      "Tu pedido quedó registrado. Si ya pagaste, lo confirmaremos en cuanto Clip procese el pago."
    );
  }

  if (closePaymentBanner) {
    closePaymentBanner.addEventListener("click", dismissPaymentBanner);
  }

  /* ---------------------------------------------------------------------- */
  /* Guía de tallas                                                          */
  /* ---------------------------------------------------------------------- */

  function openSizeGuide() {
    lastFocusedElement = document.activeElement;
    sizeModal.classList.add("is-open");
    sizeModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
    window.setTimeout(() => {
      const close = $("[data-close-sizes]");
      if (close) close.focus({ preventScroll: true });
    }, 80);
  }

  function closeSizeGuide() {
    sizeModal.classList.remove("is-open");
    sizeModal.setAttribute("aria-hidden", "true");
    if (!cartDrawer.classList.contains("is-open") && !checkoutModal.classList.contains("is-open")) {
      document.body.classList.remove("is-locked");
    }
    if (lastFocusedElement && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus({ preventScroll: true });
    }
  }

  const sizeGuideButton = $("[data-size-guide]");
  if (sizeGuideButton) sizeGuideButton.addEventListener("click", openSizeGuide);
  const closeSizeButton = $("[data-close-sizes]");
  if (closeSizeButton) closeSizeButton.addEventListener("click", closeSizeGuide);
  if (sizeModal) {
    sizeModal.addEventListener("click", (event) => {
      if (event.target === sizeModal) closeSizeGuide();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Configurador                                                            */
  /* ---------------------------------------------------------------------- */

  function updateTextColorUI() {
    const design = activeDesign();
    textColorButtons.forEach((button) => {
      const active =
        button.dataset.textColor.toLowerCase() === design.textColor.toLowerCase();
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateTextFontUI() {
    const design = activeDesign();
    fontButtons.forEach((button) => {
      const active = button.dataset.textFont === design.textFont;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateMaterialUI() {
    if (materialLabel) materialLabel.textContent = state.material.name;

    materialButtons.forEach((button) => {
      const active = button.dataset.material === state.material.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (materialNote) {
      const delta = state.material.delta;
      const suffix =
        delta === 0
          ? " Incluido."
          : delta > 0
            ? ` +${formatPrice(delta)}.`
            : ` Ahorras ${formatPrice(Math.abs(delta))}.`;
      materialNote.textContent = state.material.desc + suffix;
    }
  }

  function updateTechniqueUI() {
    if (techniqueLabel) techniqueLabel.textContent = state.technique.name;

    techniqueButtons.forEach((button) => {
      const active = button.dataset.technique === state.technique.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (techniqueNote) {
      let suffix = " Incluido.";
      if (state.technique.price > 0) {
        suffix = hasAnyDesign()
          ? ` Se suma ${formatPrice(state.technique.price)} una vez por pedido.`
          : ` Se sumará ${formatPrice(state.technique.price)} cuando añadas texto o logo.`;
      }
      techniqueNote.textContent = state.technique.desc + suffix;
    }

    if (techniqueWarning) {
      let warning = "";
      if (
        state.technique.id === "sublimacion" &&
        state.material.id !== "polyester280"
      ) {
        warning =
          "La sublimación necesita un tejido de poliéster. Cambia a Poliéster técnico para el mejor resultado.";
      } else if (
        state.technique.id === "dtg" &&
        state.material.id === "polyester280"
      ) {
        warning =
          "El DTG rinde mejor sobre algodón. En poliéster recomendamos DTF o sublimación.";
      }
      techniqueWarning.hidden = !warning;
      techniqueWarning.textContent = warning;
    }
  }

  function setTool(tool) {
    toolButtons.forEach((button) => {
      const active = button.dataset.personalizeTool === tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    toolPanels.forEach((panel) => {
      panel.hidden = panel.dataset.personalizePanel !== tool;
    });
  }

  let tooltipTarget = null;

  function positionOptionTooltip(button) {
    const rect = button.getBoundingClientRect();
    const tip = optionTooltip.getBoundingClientRect();
    const gap = 10;
    let left = rect.left + rect.width / 2 - tip.width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tip.width - 12));

    let top = rect.top - tip.height - gap;
    let below = false;
    if (top < 12) {
      top = rect.bottom + gap;
      below = true;
    }

    optionTooltip.style.left = `${left}px`;
    optionTooltip.style.top = `${top}px`;
    const arrow = rect.left + rect.width / 2 - left;
    optionTooltip.style.setProperty(
      "--arrow-left",
      `${Math.min(Math.max(arrow, 14), tip.width - 14)}px`
    );
    optionTooltip.classList.toggle("is-below", below);
  }

  function showOptionTooltip(button) {
    if (!optionTooltip || !button.dataset.desc) return;
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;

    tooltipTitle.textContent = button.dataset.name || "";
    tooltipDesc.textContent = button.dataset.desc;
    optionTooltip.classList.add("is-visible");
    optionTooltip.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-describedby", "option-tooltip");
    tooltipTarget = button;
    positionOptionTooltip(button);
  }

  function hideOptionTooltip() {
    if (!optionTooltip) return;
    optionTooltip.classList.remove("is-visible");
    optionTooltip.setAttribute("aria-hidden", "true");
    if (tooltipTarget) {
      tooltipTarget.removeAttribute("aria-describedby");
      tooltipTarget = null;
    }
  }

  function priceNoteText() {
    const parts = [`Base ${formatPrice(state.basePrice)}`];

    if (state.material.delta !== 0) {
      const sign = state.material.delta > 0 ? "+" : "−";
      parts.push(
        `${state.material.name} ${sign}${formatPrice(
          Math.abs(state.material.delta)
        )}`
      );
    }
    if (hasAnyDesign() && state.technique.price > 0) {
      parts.push(`${state.technique.name} +${formatPrice(state.technique.price)}`);
    }

    const count = logoCount();
    if (count > 0) {
      parts.push(
        `${count === 1 ? "logo" : `${count} logos`} +${formatPrice(
          LOGO_PRICE * count
        )}`
      );
    }
    if (state.size === "XXL") parts.push(`XXL +${formatPrice(XXL_PRICE)}`);
    parts.push("IVA incluido");
    return parts.join(" · ");
  }

  function updatePreview() {
    const design = activeDesign();

    if (hoodiePreview) {
      const isFront = state.view === "front";
      const isSide = state.angle === 90 || state.angle === 270;
      const imageFile = isSide
        ? "hoodie-side-right.png?v=20261110"
        : `hoodie-${isFront ? "front" : "back"}.png`;
      const isDark = state.color.toLowerCase() === "#1c1c1f";
      hoodiePreview.style.setProperty("--fabric-color", state.color);
      hoodiePreview.style.setProperty(
        "--tint-mask",
        `url("assets/${imageFile}")`
      );
      hoodiePreview.classList.toggle("is-dark", isDark);
      hoodiePreview.classList.toggle("is-side-view", isSide);
      hoodiePreview.classList.toggle("is-left-view", state.angle === 270);

      MATERIAL_IDS.forEach((id) => {
        hoodiePreview.classList.toggle(
          `material-${id}`,
          state.material.id === id
        );
      });
      TECHNIQUE_IDS.forEach((id) => {
        hoodiePreview.classList.toggle(
          `technique-${id}`,
          state.technique.id === id
        );
      });

      if (hoodiePhoto) {
        hoodiePhoto.src = `assets/${imageFile}`;
        hoodiePhoto.alt = isSide
          ? "Vista de perfil de tu sudadera personalizada"
          : `Vista ${
              isFront ? "frontal" : "trasera"
            } de tu sudadera personalizada`;
        hoodiePhoto.width = 1003;
        hoodiePhoto.height = 1229;
      }
      if (studio) studio.classList.toggle("is-side-view", isSide);
      if (personalizePanel) {
        if (isSide) {
          personalizePanel.setAttribute("inert", "");
          personalizePanel.setAttribute("aria-hidden", "true");
        } else {
          personalizePanel.removeAttribute("inert");
          personalizePanel.removeAttribute("aria-hidden");
        }
      }
      if (hintText) {
        hintText.textContent = isSide
          ? "Vista de perfil. Elige Frente o Espalda para editar el diseño."
          : "Arrastra el texto o el logo y ajusta su tamaño.";
      }
    }

    previewNames.forEach((element) => {
      element.textContent = state.colorName;
    });

    if (previewSwatch) previewSwatch.style.background = state.color;
    if (previewSize) previewSize.textContent = state.size;
    if (previewMaterial) previewMaterial.textContent = state.material.name;
    if (previewTechnique) previewTechnique.textContent = state.technique.name;

    if (printText) {
      printText.textContent = design.text;
      printText.hidden = design.text.length === 0;
      printText.style.color = design.textColor;
      printText.style.setProperty("--x", `${design.textX}%`);
      printText.style.setProperty("--y", `${design.textY}%`);
      printText.style.setProperty("--item-scale", design.textScale || 1);
      printText.style.setProperty("--item-rotate", `${design.textRotate || 0}deg`);
      const font = TEXT_FONTS[design.textFont] || TEXT_FONTS.bricolage;
      Object.values(TEXT_FONTS).forEach((item) => {
        printText.classList.remove(item.className);
      });
      printText.classList.add(font.className);
      printText.setAttribute(
        "aria-label",
        design.text
          ? `Texto "${design.text}". Arrastra para moverlo.`
          : "Texto del diseño. Arrastra para moverlo."
      );
    }

    if (printLogo) {
      if (design.logo) {
        printLogo.src = design.logo;
        printLogo.alt = `Logo de la vista ${state.view === "front" ? "frontal" : "trasera"}`;
        printLogo.hidden = false;
      } else {
        printLogo.removeAttribute("src");
        printLogo.alt = "";
        printLogo.hidden = true;
      }
      printLogo.style.setProperty("--x", `${design.logoX}%`);
      printLogo.style.setProperty("--y", `${design.logoY}%`);
      printLogo.style.setProperty("--item-scale", design.logoScale || 1);
      printLogo.style.setProperty("--item-rotate", `${design.logoRotate || 0}deg`);
    }

    const total =
      state.basePrice +
      state.material.delta +
      techniqueFee() +
      logoCount() * LOGO_PRICE +
      (state.size === "XXL" ? XXL_PRICE : 0);

    if (priceEl) priceEl.textContent = formatPrice(total);
    if (priceNote) priceNote.textContent = priceNoteText();
    if (priceMirrorEl) priceMirrorEl.textContent = formatPrice(total);

    updateTextColorUI();
    updateTextFontUI();
    updateMaterialUI();
    updateTechniqueUI();
    // el repintado reescribe el contenido: las asas deben volver
    setupHandles(printText);
    setupHandles(printLogo);
  }

  function updateGalleryUI() {
    viewThumbs.forEach((button) => {
      const active = Number(button.dataset.angle) === state.angle;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setAngle(angle) {
    const normalized = ((Number(angle) % 360) + 360) % 360;
    if (normalized === 90 || normalized === 270) {
      state.angle = normalized;
      updateGalleryUI();
      updatePreview();
      return;
    }
    setView(normalized === 180 ? "back" : "front");
  }

  function setView(view) {
    if (!state.designs[view]) return;
    state.view = view;
    state.angle = view === "front" ? 0 : 180;
    updateGalleryUI();

    viewButtons.forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (editingLabel) {
      editingLabel.textContent = view === "front" ? "frente" : "espalda";
    }

    const design = activeDesign();
    if (textInput) textInput.value = design.text;
    if (charCount) charCount.textContent = String(design.text.length);
    if (textSizeInput) {
      textSizeInput.value = String(Math.round((design.textScale || 1) * 100));
    }
    if (textSizeValue) {
      textSizeValue.textContent = `${Math.round((design.textScale || 1) * 100)}%`;
    }
    if (logoSizeInput) {
      logoSizeInput.value = String(Math.round((design.logoScale || 1) * 100));
    }
    if (logoSizeValue) {
      logoSizeValue.textContent = `${Math.round((design.logoScale || 1) * 100)}%`;
    }
    if (logoInput) logoInput.value = "";
    if (uploadFile) uploadFile.hidden = !design.logo;
    if (fileName) fileName.textContent = design.logoName || "";

    updatePreview();
  }

  function selectColor(hex, name) {
    state.color = hex;
    state.colorName = name;
    state.basePrice = BASE_PRICES[hex] || state.basePrice;

    const recommendation = contrastFor(hex);
    ["front", "back"].forEach((side) => {
      const design = state.designs[side];
      const current = design.textColor.toLowerCase();
      if (current === "#fffdf8" || current === "#1c1c1f") {
        design.textColor = recommendation;
      }
    });

    colorSwatches.forEach((button) => {
      const active = button.dataset.color.toLowerCase() === hex.toLowerCase();
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    updatePreview();
  }


  /* Asas de tamaño y rotación directamente sobre la prenda */
  function setupHandles(element) {
    if (!element || element.querySelector(".edit-handle")) return;
    const type = element.dataset.printType;
    if (!type) return;

    const iconResize =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
    const iconRotate =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/></svg>';

    const build = (kind, label, icon) => {
      const handle = document.createElement("span");
      handle.className = "edit-handle edit-handle--" + kind;
      handle.setAttribute("role", "button");
      handle.setAttribute("tabindex", "0");
      handle.setAttribute("aria-label", label);
      handle.innerHTML = icon;
      element.appendChild(handle);
      return handle;
    };

    const resizeHandle = build("resize", "Redimensionar. Arrastra o usa las flechas verticales.", iconResize);
    const rotateHandle = build("rotate", "Rotar. Arrastra o usa las flechas horizontales.", iconRotate);

    let mode = null;
    let pointerId = null;
    let startDist = 1;
    let startScale = 1;
    let startAngle = 0;
    let startRotate = 0;

    const design = () => state.designs[state.view];
    const scaleKey = type === "text" ? "textScale" : "logoScale";
    const rotateKey = type === "text" ? "textRotate" : "logoRotate";

    const centerOf = () => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    function setScale(value) {
      const input = type === "text" ? textSizeInput : logoSizeInput;
      const output = type === "text" ? textSizeValue : logoSizeValue;
      const min = input && input.min ? Number(input.min) / 100 : 0.5;
      const max = input && input.max ? Number(input.max) / 100 : 2;
      const next = Math.min(max, Math.max(min, value));
      design()[scaleKey] = next;
      element.style.setProperty("--item-scale", next);
      if (input) input.value = String(Math.round(next * 100));
      if (output) output.textContent = Math.round(next * 100) + "%";
    }

    function setRotate(value) {
      let next = value;
      while (next > 180) next -= 360;
      while (next < -180) next += 360;
      design()[rotateKey] = Math.round(next);
      element.style.setProperty("--item-rotate", next + "deg");
    }

    function begin(event, which) {
      event.preventDefault();
      event.stopPropagation();
      mode = which;
      pointerId = event.pointerId;
      const center = centerOf();
      if (which === "resize") {
        startDist = Math.max(14, Math.hypot(event.clientX - center.x, event.clientY - center.y));
        startScale = design()[scaleKey] || 1;
      } else {
        startAngle = (Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180) / Math.PI;
        startRotate = design()[rotateKey] || 0;
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        /* puntero sintético */
      }
      element.classList.add("is-dragging");
    }

    function move(event) {
      if (!mode || event.pointerId !== pointerId) return;
      event.preventDefault();
      const center = centerOf();
      if (mode === "resize") {
        const dist = Math.hypot(event.clientX - center.x, event.clientY - center.y);
        setScale((startScale * dist) / startDist);
      } else {
        const angle = (Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180) / Math.PI;
        let next = startRotate + (angle - startAngle);
        if (event.shiftKey) next = Math.round(next / 15) * 15;
        setRotate(next);
      }
    }

    function end(event) {
      if (!mode) return;
      mode = null;
      pointerId = null;
      element.classList.remove("is-dragging");
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* la captura pudo perderse */
      }
    }

    [resizeHandle, rotateHandle].forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => begin(event, handle === resizeHandle ? "resize" : "rotate"));
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);

      handle.addEventListener("keydown", (event) => {
        const key = event.key;
        if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 10 : 5;
        if (handle === resizeHandle) {
          setScale((design()[scaleKey] || 1) + (key === "ArrowUp" ? 0.05 : -0.05));
        } else {
          setRotate((design()[rotateKey] || 0) + (key === "ArrowRight" ? step : -step));
        }
      });
    });
  }

  function setupDraggable(element) {
    if (!element) return;
    const type = element.dataset.printType;
    if (!type) return;

    let dragging = false;
    let dragSide = "front";

    const applyPosition = (design) => {
      element.style.setProperty(
        "--x",
        `${type === "text" ? design.textX : design.logoX}%`
      );
      element.style.setProperty(
        "--y",
        `${type === "text" ? design.textY : design.logoY}%`
      );
    };

    const moveTo = (clientX, clientY) => {
      if (!hoodiePreview) return;
      const rect = hoodiePreview.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = clampPosition(((clientX - rect.left) / rect.width) * 100, type, "x");
      const y = clampPosition(((clientY - rect.top) / rect.height) * 100, type, "y");
      const design = state.designs[dragSide];

      if (type === "text") {
        design.textX = Math.round(x * 10) / 10;
        design.textY = Math.round(y * 10) / 10;
      } else {
        design.logoX = Math.round(x * 10) / 10;
        design.logoY = Math.round(y * 10) / 10;
      }

      applyPosition(design);
    };

    element.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (element.hidden) return;
      event.preventDefault();
      dragSide = state.view;
      dragging = true;
      element.classList.add("is-dragging");
      element.focus({ preventScroll: true });
      try {
        element.setPointerCapture(event.pointerId);
      } catch (error) {
        /* Algunos navegadores no permiten capturar el puntero. */
      }
      moveTo(event.clientX, event.clientY);
    });

    element.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      moveTo(event.clientX, event.clientY);
    });

    const endDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      element.classList.remove("is-dragging");
      try {
        element.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* La captura pudo haberse perdido. */
      }
    };

    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);

    element.addEventListener("keydown", (event) => {
      const allowed = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!allowed.includes(event.key)) return;
      event.preventDefault();
      const design = activeDesign();
      const step = event.shiftKey ? 5 : 1;

      if (type === "text") {
        if (event.key === "ArrowLeft") design.textX = clampPosition(design.textX - step, "text", "x");
        if (event.key === "ArrowRight") design.textX = clampPosition(design.textX + step, "text", "x");
        if (event.key === "ArrowUp") design.textY = clampPosition(design.textY - step, "text", "y");
        if (event.key === "ArrowDown") design.textY = clampPosition(design.textY + step, "text", "y");
      } else {
        if (event.key === "ArrowLeft") design.logoX = clampPosition(design.logoX - step, "logo", "x");
        if (event.key === "ArrowRight") design.logoX = clampPosition(design.logoX + step, "logo", "x");
        if (event.key === "ArrowUp") design.logoY = clampPosition(design.logoY - step, "logo", "y");
        if (event.key === "ArrowDown") design.logoY = clampPosition(design.logoY + step, "logo", "y");
      }

      applyPosition(design);
    });
  }

  colorSwatches.forEach((button) => {
    button.addEventListener("click", () => {
      selectColor(button.dataset.color, button.dataset.name);
    });
  });

  sizeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.size = button.dataset.size;
      sizeButtons.forEach((sizeButton) => {
        const active = sizeButton.dataset.size === state.size;
        sizeButton.classList.toggle("is-active", active);
        sizeButton.setAttribute("aria-pressed", String(active));
      });
      updatePreview();
    });
  });

  materialButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.material = {
        id: button.dataset.material,
        name: button.dataset.name,
        delta: Number(button.dataset.delta) || 0,
        desc: button.dataset.desc,
      };
      updatePreview();
    });
  });

  techniqueButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.technique = {
        id: button.dataset.technique,
        name: button.dataset.name,
        price: Number(button.dataset.cost) || 0,
        desc: button.dataset.desc,
      };
      updatePreview();
    });
  });

  $$("[data-desc]").forEach((button) => {
    button.addEventListener("mouseenter", () => showOptionTooltip(button));
    button.addEventListener("mouseleave", hideOptionTooltip);
    button.addEventListener("focus", () => showOptionTooltip(button));
    button.addEventListener("blur", hideOptionTooltip);
    button.addEventListener("click", hideOptionTooltip);
  });

  window.addEventListener(
    "scroll",
    () => {
      if (tooltipTarget) positionOptionTooltip(tooltipTarget);
    },
    { passive: true }
  );
  window.addEventListener("resize", () => {
    if (tooltipTarget) positionOptionTooltip(tooltipTarget);
  });

  toolButtons.forEach((button) => {
    button.addEventListener("click", () =>
      setTool(button.dataset.personalizeTool)
    );
  });

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  viewThumbs.forEach((button) => {
    button.addEventListener("click", () => setAngle(button.dataset.angle));
  });

  if (textInput) {
    textInput.addEventListener("input", () => {
      const design = activeDesign();
      design.text = textInput.value.toUpperCase();
      if (charCount) charCount.textContent = String(design.text.length);
      updatePreview();
    });
  }

  textColorButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeDesign().textColor = button.dataset.textColor;
      updatePreview();
    });
  });

  fontButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeDesign().textFont = button.dataset.textFont;
      updatePreview();
    });
  });

  if (textSizeInput) {
    textSizeInput.addEventListener("input", () => {
      const design = activeDesign();
      design.textScale = Number(textSizeInput.value) / 100;
      if (textSizeValue) textSizeValue.textContent = `${textSizeInput.value}%`;
      updatePreview();
    });
  }

  if (logoSizeInput) {
    logoSizeInput.addEventListener("input", () => {
      const design = activeDesign();
      design.logoScale = Number(logoSizeInput.value) / 100;
      if (logoSizeValue) logoSizeValue.textContent = `${logoSizeInput.value}%`;
      updatePreview();
    });
  }

  const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
  const LOGO_MAX_BYTES = 5 * 1024 * 1024;
  const LOGO_MAX_DATA_URL = 1_800_000;

  function prepareLogoData(dataUrl, mime) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const make = (maxSide) => {
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          if (!context) return dataUrl;
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const outputMime = mime === "image/jpeg" ? "image/jpeg" : "image/png";
          return canvas.toDataURL(outputMime, 0.9);
        };

        if (dataUrl.length <= LOGO_MAX_DATA_URL && Math.max(image.width, image.height) <= 1400) {
          resolve(dataUrl);
          return;
        }

        let output = make(1200);
        if (output.length > LOGO_MAX_DATA_URL) output = make(1000);
        if (output.length > LOGO_MAX_DATA_URL) output = make(800);
        resolve(output);
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }

  if (logoInput) {
    logoInput.addEventListener("change", () => {
      const file = logoInput.files && logoInput.files[0];
      if (!file) return;

      if (!LOGO_TYPES.includes(file.type)) {
        showToast("Formato no válido. Usa PNG, JPG o WebP.");
        logoInput.value = "";
        return;
      }

      if (file.size > LOGO_MAX_BYTES) {
        showToast("El logo no puede superar los 5 MB.");
        logoInput.value = "";
        return;
      }

      const side = state.view;
      const reader = new FileReader();
      reader.onload = async () => {
        const design = state.designs[side];
        const source = String(reader.result);
        design.logo = source;
        design.logoName = file.name;
        design.logoPath = "";
        design.logoData = await prepareLogoData(source, file.type);

        if (state.view === side) {
          if (uploadFile) uploadFile.hidden = false;
          if (fileName) fileName.textContent = file.name;
        }
        updatePreview();
        showToast(
          `Logo ${side === "front" ? "frontal" : "trasero"} cargado.`
        );

        if (window.StoreSupabase?.uploadLogo) {
          const path = await window.StoreSupabase.uploadLogo(file, side);
          if (path && design.logo === source) {
            design.logoPath = path;
            design.logoData = "";
          }
        }
      };
      reader.onerror = () => {
        showToast("No hemos podido leer el archivo. Inténtalo de nuevo.");
        logoInput.value = "";
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeLogoButton) {
    removeLogoButton.addEventListener("click", () => {
      const design = activeDesign();
      design.logo = null;
      design.logoName = "";
      design.logoPath = "";
      design.logoData = "";
      if (logoInput) logoInput.value = "";
      if (uploadFile) uploadFile.hidden = true;
      updatePreview();
    });
  }

  if (resetPrintButton) {
    resetPrintButton.addEventListener("click", () => {
      const design = activeDesign();
      const defaults = DEFAULT_POSITIONS[state.view];
      design.textX = defaults.textX;
      design.textY = defaults.textY;
      design.logoX = defaults.logoX;
      design.logoY = defaults.logoY;
      updatePreview();
      showToast("Diseño centrado de nuevo.");
    });
  }

  setupDraggable(printText);
  setupDraggable(printLogo);
  setupHandles(printText);
  setupHandles(printLogo);

  if (addMirrorButton && addToCartButton) {
    addMirrorButton.addEventListener("click", () => addToCartButton.click());
  }

  if (addToCartButton) {
    addToCartButton.addEventListener("click", () => {
      // no se puede comprar una sudadera "personalizada" sin diseño
      const hasDesign = ["front", "back"].some((view) => {
        const design = state.designs[view];
        if (!design) return false;
        return Boolean((design.text && design.text.trim()) || design.logoName);
      });
      if (!hasDesign) {
        showToast("Añade un texto o un logo antes de añadir a la cesta.");
        const editor = $("[data-print-text]");
        if (editor) editor.focus({ preventScroll: true });
        return;
      }

      if (
        state.technique.id === "sublimacion" &&
        state.material.id !== "polyester280"
      ) {
        showToast(
          "La sublimación requiere poliéster. Cambia el material o elige otra técnica."
        );
        return;
      }

      const front = state.designs.front;
      const back = state.designs.back;
      state.cartStep = "cart";
      const unitPrice =
        state.basePrice +
        state.material.delta +
        techniqueFee() +
        logoCount() * LOGO_PRICE +
        (state.size === "XXL" ? XXL_PRICE : 0);

      const designSnapshot = {
        color: state.color,
        size: state.size,
        material: {
          id: state.material.id,
          name: state.material.name,
          delta: state.material.delta,
        },
        technique: {
          id: state.technique.id,
          name: state.technique.name,
          price: state.technique.price,
        },
        front: {
          text: front.text,
          textColor: front.textColor,
          textScale: front.textScale,
          textRotate: front.textRotate || 0,
          textFont: front.textFont,
          logoName: front.logoName,
          logoPath: front.logoPath || "",
          logoData: front.logoData || "",
          logoScale: front.logoScale,
          logoRotate: front.logoRotate || 0,
          textX: front.textX,
          textY: front.textY,
          logoX: front.logoX,
          logoY: front.logoY,
        },
        back: {
          text: back.text,
          textColor: back.textColor,
          textScale: back.textScale,
          textRotate: back.textRotate || 0,
          textFont: back.textFont,
          logoName: back.logoName,
          logoPath: back.logoPath || "",
          logoData: back.logoData || "",
          logoScale: back.logoScale,
          logoRotate: back.logoRotate || 0,
          textX: back.textX,
          textY: back.textY,
          logoX: back.logoX,
          logoY: back.logoY,
        },
        basePrice: state.basePrice,
      };
      const keySnapshot = {
        ...designSnapshot,
        front: { ...designSnapshot.front, logoData: "", logoPath: "" },
        back: { ...designSnapshot.back, logoData: "", logoPath: "" },
      };
      const key = JSON.stringify(keySnapshot);

      const existing = state.items.find((item) => item.key === key);
      if (existing) {
        existing.qty += 1;
      } else {
        state.items.push({
          id: uid(),
          key,
          name: "Sudadera personalizada",
          colorHex: state.color,
          colorName: state.colorName,
          size: state.size,
          materialId: state.material.id,
          materialName: state.material.name,
          materialDelta: state.material.delta,
          techniqueId: state.technique.id,
          techniqueName: state.technique.name,
          techniquePrice: techniqueFee(),
          front: designSnapshot.front,
          back: designSnapshot.back,
          unitPrice,
          qty: 1,
        });
      }

      saveCart();
      renderCart();
      openCart();
      window.StoreSupabase?.track("add_to_cart", {
        total: unitPrice,
        size: state.size,
        material: state.material.name,
        technique: state.technique.name,
      });

      if (cartCount) {
        cartCount.classList.remove("is-pulsing");
        void cartCount.offsetWidth;
        cartCount.classList.add("is-pulsing");
      }
    });
  }

  function scrollToDesigner() {
    const section = $("#personalizar");
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      if (section.getBoundingClientRect().top > 120) {
        section.scrollIntoView({ behavior: "auto", block: "start" });
      }
    }, 650);
  }

  personalizeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectColor(button.dataset.color, button.dataset.name);
      setView("front");
      scrollToDesigner();
      showToast(`${button.dataset.name}: lista para personalizar.`);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Inspiración desde el calendario de conciertos                           */
  /* ---------------------------------------------------------------------- */

  function designWithText(text) {
    const clean = String(text || "").trim().toUpperCase().slice(0, 16);
    if (!clean) return;

    setTool("texto");
    setView("front");

    const design = activeDesign();
    design.text = clean;
    if (textInput) textInput.value = clean;
    if (charCount) charCount.textContent = String(clean.length);
    updatePreview();
    scrollToDesigner();
    showToast(`“${clean}” lista para personalizar.`);
  }

  window.likeHoodieDesignWith = designWithText;

  /* ---------------------------------------------------------------------- */
  /* Cabecera y menú móvil                                                   */
  /* ---------------------------------------------------------------------- */

  function closeMenu() {
    if (!header) return;
    header.classList.remove("menu-open");
    if (menuToggle) {
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Abrir menú");
    }
  }

  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      const isOpen = header.classList.toggle("menu-open");
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      menuToggle.setAttribute("aria-label", isOpen ? "Cerrar menú" : "Abrir menú");
    });
  }

  if (mobileMenu) {
    mobileMenu.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeMenu();
    });
  }

  document.addEventListener("click", (event) => {
    if (
      header &&
      header.classList.contains("menu-open") &&
      !header.contains(event.target)
    ) {
      closeMenu();
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
    },
    { passive: true }
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (sizeModal && sizeModal.classList.contains("is-open")) {
      closeSizeGuide();
    } else if (checkoutModal && checkoutModal.classList.contains("is-open")) {
      closeCheckout();
    } else if (cartDrawer && cartDrawer.classList.contains("is-open")) {
      closeCart();
    } else {
      closeMenu();
    }
  });

  /* ---------------------------------------------------------------------- */
  /* Newsletter                                                              */
  /* ---------------------------------------------------------------------- */

  newsletterForms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const field = form.querySelector('input[type="email"]');
      const button = form.querySelector('button[type="submit"]');
      const honeypot = form.querySelector('input[name="website"]');
      const email = field ? field.value : "";

      // campo trampa: si viene relleno, es un bot (le damos éxito falso)
      if (honeypot && honeypot.value.trim() !== "") {
        form.reset();
        return;
      }

      if (button) button.disabled = true;

      let result = { ok: false, reason: "unsupported" };
      if (window.StoreSupabase?.subscribeNewsletter) {
        result = await window.StoreSupabase.subscribeNewsletter(email);
      }

      if (button) button.disabled = false;

      if (result.ok) {
        form.reset();
        const success = document.createElement("div");
        success.className = "newsletter-success";
        success.innerHTML =
          "<strong>¡Dentro!</strong> Tu código de bienvenida es " +
          '<span class="newsletter-code">BIENVENIDA10</span> · 10 % en tu primer pedido.' +
          (result.duplicate ? " Ya estabas en la lista." : "");
        form.replaceWith(success);
        showToast("¡Bienvenido al club! Tu código es BIENVENIDA10.");
      } else {
        showToast("No pudimos guardar tu correo. Inténtalo de nuevo en un momento.");
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Animaciones de entrada                                                  */
  /* ---------------------------------------------------------------------- */

  const revealElements = $$(".reveal");

  if ("IntersectionObserver" in window && revealElements.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -36px 0px" }
    );

    revealElements.forEach((element) => observer.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add("is-visible"));
  }

  /* ---------------------------------------------------------------------- */
  /* Inicio                                                                  */
  /* ---------------------------------------------------------------------- */

  selectColor(state.color, state.colorName);
  setView(state.view);
  setTool("texto");
  renderCart();
  window.StoreSupabase?.init();
  if (state.items.length) {
    window.StoreSupabase?.syncCart(state.items, "cart");
  }
  loadPaymentConfig();
  initPaymentBanner();
})();

/* --------------------------------------------------------------------------
   Modales: cierre por arrastre desde el asa superior (hoja en mÃ³vil)
   -------------------------------------------------------------------------- */
(function sheetDrag() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const project = (velocity, deceleration = 0.998) =>
    ((velocity / 1000) * deceleration) / (1 - deceleration);

  function spring(from, to, initialVelocity, onFrame, onDone) {
    const omega = (2 * Math.PI) / 0.34;
    let value = from;
    let velocity = initialVelocity;
    let last = performance.now();
    let frame = 0;

    function step(now) {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const acceleration = -omega * omega * (value - to) - 2 * omega * velocity;
      velocity += acceleration * dt;
      value += velocity * dt;

      if (Math.abs(value - to) < 0.4 && Math.abs(velocity) < 12) {
        onFrame(to);
        if (onDone) onDone();
        return;
      }

      onFrame(value);
      frame = requestAnimationFrame(step);
    }

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }

  document.querySelectorAll(".sheet-grab").forEach((grab) => {
    const panel = grab.closest(".modal-panel");
    const modal = grab.closest(".modal");
    if (!panel || !modal) return;

    const closeButton = modal.querySelector("[data-close-checkout], [data-close-sizes]");
    let drag = null;
    let settle = null;
    let ignoreClick = false;
    let ignoreClickTimer = 0;

    grab.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || reduceMotion.matches) return;
      if (settle) {
        settle();
        settle = null;
      }
      drag = {
        id: event.pointerId,
        startY: event.clientY,
        offset: 0,
        velocity: 0,
        lastTime: performance.now(),
        lastOffset: 0,
        tracking: false,
      };
      try {
        grab.setPointerCapture(event.pointerId);
      } catch (error) {
        /* puntero sintÃ©tico */
      }
    });

    grab.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;

      const dy = event.clientY - drag.startY;
      if (!drag.tracking) {
        if (Math.abs(dy) < 8) return;
        drag.tracking = true;
        drag.lastTime = performance.now();
        panel.classList.add("is-dragging");
      }

      // hacia arriba ofrece resistencia, hacia abajo sigue el dedo
      const offset = dy < 0 ? dy * 0.25 : dy;
      drag.offset = offset;

      const now = performance.now();
      const dt = Math.max(now - drag.lastTime, 1);
      if (dt < 120) {
        const instant = ((offset - drag.lastOffset) / dt) * 1000;
        drag.velocity = drag.velocity * 0.3 + instant * 0.7;
        drag.velocity = Math.max(-4000, Math.min(4000, drag.velocity));
      }
      drag.lastTime = now;
      drag.lastOffset = offset;

      panel.style.transform = `translate3d(0, ${offset}px, 0)`;
    });

    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.tracking) {
        drag = null;
        return;
      }

      const height = panel.getBoundingClientRect().height;
      const from = drag.offset;
      const velocity = drag.velocity;
      const projected = from + project(velocity);
      const shouldClose = projected > Math.min(height * 0.35, 220) || velocity > 900;

      drag = null;
      ignoreClick = true;
      window.clearTimeout(ignoreClickTimer);
      ignoreClickTimer = window.setTimeout(() => {
        ignoreClick = false;
      }, 350);

      settle = spring(
        from,
        shouldClose ? height : 0,
        velocity,
        (value) => {
          panel.style.transform = `translate3d(0, ${value}px, 0)`;
        },
        () => {
          settle = null;
          panel.classList.remove("is-dragging");
          if (shouldClose) {
            // el panel ya está fuera de pantalla: sin transición para que
            // no se vea reentrar mientras el fondo se desvanece
            panel.style.transition = "none";
            if (closeButton) closeButton.click();
            panel.style.removeProperty("transform");
            requestAnimationFrame(() => {
              panel.style.removeProperty("transition");
            });
          } else {
            panel.style.removeProperty("transform");
          }
        }
      );
    }

    grab.addEventListener("pointerup", endDrag);
    grab.addEventListener("pointercancel", endDrag);

    grab.addEventListener(
      "click",
      (event) => {
        if (!ignoreClick) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );
  });
})();
