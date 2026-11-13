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
    "#ffffff": 949,
    "#efe6d6": 949,
    "#cdf25a": 969,
    "#f2603c": 949,
    "#26324f": 899,
    "#efb7c4": 899,
  };

  /* Cada producto define sus imágenes, su precio base por color y sus valores
     por defecto. Así el configurador sirve para la sudadera y para el tote. */
  const PRODUCTS = {
    hoodie: {
      label: "Sudadera",
      itemName: "Sudadera personalizada",
      images: {
        front: "assets/hoodie-front.png",
        back: "assets/hoodie-back.png",
      },
      prices: BASE_PRICES,
      fallbackPrice: 899,
      defaults: {
        size: "M",
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
      },
    },
    tote: {
      label: "Tote bag",
      itemName: "Tote bag personalizado",
      images: {
        front: "assets/tote-front.svg",
        back: "assets/tote-back.svg",
      },
      prices: {
        "#efe6d6": 349,
        "#ffffff": 379,
        "#1c1c1f": 379,
        "#cdf25a": 379,
        "#f2603c": 379,
        "#26324f": 379,
        "#efb7c4": 379,
      },
      fallbackPrice: 379,
      defaults: {
        size: "Única",
        material: {
          id: "loneta12",
          name: "Loneta 12 oz",
          delta: 0,
          desc: "Lona de algodón 12 oz: firme, con cuerpo y caída recta.",
        },
        technique: {
          id: "dtf",
          name: "DTF",
          price: 0,
          desc: "Transfer directo al film: colores vivos y muy duradero en lona.",
        },
      },
    },
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
    product: "hoodie",
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
        logoRaster: "",
        logoIsVector: false,
        logoVectorResult: null,
        vectorMode: "",
        logoAssetId: "",
        printStatus: "",
        printDpi: null,
        printPath: "",
        printWidthCm: null,
        printError: "",
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
        logoRaster: "",
        logoIsVector: false,
        logoVectorResult: null,
        vectorMode: "",
        logoAssetId: "",
        printStatus: "",
        printDpi: null,
        printPath: "",
        printWidthCm: null,
        printError: "",
        ...DEFAULT_POSITIONS.back,
      },
    },
    items: loadCart(),
  };

  /* Estado del zoom de la prenda (se declara pronto para usarlo en las asas) */
  let zoomLevel = 1;
  let zoomPanX = 0;
  let zoomPanY = 0;

  /* ---------------------------------------------------------------------- */
  /* Utilidades                                                              */
  /* ---------------------------------------------------------------------- */

  /* Mantiene las asas proporcionadas al tamaño real del logo o texto:
     ni gigantes en diseños pequeños ni diminutas al ampliar. */
  const handleSizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          entries.forEach((entry) => updateHandleScale(entry.target));
        })
      : null;

  function updateHandleScale(element) {
    if (!element) return;
    const type = element.dataset.printType;
    if (!type) return;
    const design = state.designs[state.view];
    const scale = type === "text" ? design.textScale || 1 : design.logoScale || 1;
    const factor = Math.max(0.01, scale * zoomLevel);
    const base =
      parseFloat(
        getComputedStyle(element).getPropertyValue("--handle-size")
      ) || 30;
    const width = element.offsetWidth || 0;
    const height = element.offsetHeight || 0;
    const visual = Math.min(width || 120, height || 120) * factor;
    const target = Math.min(30, Math.max(22, visual * 0.13));
    element.style.setProperty(
      "--handle-scale",
      String(target / (base * factor))
    );
  }

  function loadCart() {    try {
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
    const isTote = state.product === "tote";
    if (axis === "x") {
      const min = isTote ? 22 : type === "text" ? 23 : 15;
      const max = isTote ? 78 : type === "text" ? 77 : 85;
      return Math.max(min, Math.min(max, value));
    }
    const minY = isTote ? 38 : 10;
    const maxY = isTote ? 92 : 90;
    return Math.max(minY, Math.min(maxY, value));
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
  const sandboxPay = $("[data-sandbox-pay]");
  const sandboxCards = $("[data-sandbox-cards]");
  const sandboxError = $("[data-sandbox-error]");
  const clipCardPanel = $("[data-clip-card]");
  const clipCardMount = $("#clip-card-mount");
  const clipCardError = $("[data-clip-card-error]");
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
  const sizeLabelEl = $("[data-size-label]");
  const previewMaterial = $("[data-preview-material]");
  const previewTechnique = $("[data-preview-technique]");
  const printText = $("[data-print-text]");
  const printLogo = $("[data-print-logo]");
  const printLogoImg = printLogo ? printLogo.querySelector("img") : null;
  const viewThumbs = $$("[data-angle]");
  const galleryThumbs = $$(".view-thumb img");
  const productTabs = $$("[data-product-tab]");
  const productPanels = $$("[data-product-panel]");
  const hintText = $("[data-hint-text]");
  const placementView = $("[data-placement-view]");
  const placementText = $("[data-placement-text]");
  const logoCoord = $("[data-logo-coord]");
  const textCoord = $("[data-text-coord]");
  const placementStatusEl = $("[data-placement-status]");
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
  const materialLabels = $$("[data-material-label]");
  const materialNotes = $$("[data-material-note]");
  const techniqueButtons = $$("[data-technique]");
  const techniqueLabels = $$("[data-technique-label]");
  const techniqueNotes = $$("[data-technique-note]");
  const techniqueWarnings = $$("[data-technique-warning]");
  const logoInput = $("[data-logo-input]");
  const uploadFile = $("[data-upload-file]");
  const fileName = $("[data-file-name]");
  const removeLogoButton = $("[data-remove-logo]");
  const vectorPanel = $("[data-vector-panel]");
  const vectorHint = $("[data-vector-hint]");
  const vectorBadge = $("[data-vector-badge]");
  const vectorModeButtons = $$("[data-vector-mode]");
  const vectorRunButton = $("[data-vector-run]");
  const vectorRunLabel = $("[data-vector-run-label]");
  const vectorStatus = $("[data-vector-status]");
  const vectorResultEl = $("[data-vector-result]");
  const vectorOriginal = $("[data-vector-original]");
  const vectorOutput = $("[data-vector-output]");
  const vectorStats = $("[data-vector-stats]");
  const vectorVerdict = $("[data-vector-verdict]");
  const vectorApply = $("[data-vector-apply]");
  const vectorDownload = $("[data-vector-download]");
  const vectorRevert = $("[data-vector-revert]");
  const printStatus = $("[data-print-status]");
  const printStatusText = $("[data-print-status-text]");
  const printRetry = $("[data-print-retry]");
  const undoButton = $("[data-undo]");
  const redoButton = $("[data-redo]");
  const guideToggle = $("[data-guide-toggle]");
  const priceEl = $("[data-price-display]");
  const priceNote = $("[data-price-note]");
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
  const thumbCache = new Map();
  const THUMB_IMAGES = {};

  Object.entries({ hoodie: "assets/hoodie-front.png", tote: "assets/tote-front.svg" }).forEach(
    ([id, src]) => {
      const image = new Image();
      image.src = src;
      image.addEventListener("load", () => {
        thumbCache.clear();
        if (state.items && state.items.length) renderCart();
      });
      THUMB_IMAGES[id] = image;
    }
  );

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

  function makeThumb(front, colorHex, isDark, product) {
    const source = THUMB_IMAGES[product] || THUMB_IMAGES.hoodie;
    if (!source || !source.complete || !source.naturalWidth) return "";
    if (!front || !front.text) return "";

    const W = 240;
    const H = Math.round((W * source.naturalHeight) / source.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    if (isDark) {
      ctx.filter = "brightness(0.27) contrast(1.06)";
      ctx.drawImage(source, 0, 0, W, H);
      ctx.filter = "none";
    } else {
      ctx.drawImage(source, 0, 0, W, H);
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = colorHex;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.35;
      ctx.drawImage(source, 0, 0, W, H);
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
        rate: "Demasiados intentos. Espera unos minutos.",
      };
      setCouponNote(messages[result.reason] || "No pudimos validar el código.", true);
      return;
    }

    state.coupon = { code: result.code, percent: result.percent, verified: true };
    storeCoupon(state.coupon);
    window.LikeHoodieConsent?.track("coupon_applied", {
      coupon: result.code,
      percent: result.percent,
    });
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
        const productId = item.product || "hoodie";
        const product = PRODUCTS[productId] || PRODUCTS.hoodie;
        const thumbImage = product.images.front;
        const thumbKey = item.key || item.id;
        let thumbSrc = thumbCache.get(thumbKey);
        if (!thumbSrc) {
          thumbSrc = makeThumb(front, color, isDark, productId);
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
              ${thumbSrc ? `<img class="cart-thumb-img" src="${thumbSrc}" alt="">` : `<div class="hoodie ${isDark ? "is-dark" : ""}" style="--fabric-color:${color};--tint-mask:url('${thumbImage}')">
                ${isDark ? "" : '<div class="fabric-tint"></div>'}
                <img class="hoodie-photo" src="${thumbImage}" alt="" width="1003" height="1229" loading="lazy">
                <div class="print-area print-area--thumb">
                  ${front.text ? `<span class="print-text editor-item font-${escapeHTML(front.textFont || "bricolage")}" style="--x:${front.textX}%;--y:${front.textY}%;--item-scale:${front.textScale || 1};--item-rotate:${front.textRotate || 0}deg;color:${escapeHTML(front.textColor || "#fffdf9")}">${escapeHTML(front.text)}</span>` : ""}
                  ${front.logoData ? `<img class="print-logo editor-item" src="${front.logoData}" alt="" style="--x:${front.logoX}%;--y:${front.logoY}%;--item-scale:${front.logoScale || 1};--item-rotate:${front.logoRotate || 0}deg">` : ""}
                </div>
              </div>`}
            </div>
            <div class="cart-info">
              <div class="cart-item-top">
                <h3>${escapeHTML(item.name || product.itemName)}</h3>
                <button type="button" class="remove" data-remove-item="${escapeHTML(item.id)}" aria-label="Quitar ${escapeHTML(item.name || product.itemName)} de la cesta">×</button>
              </div>
              <p class="cart-meta">${escapeHTML(item.colorName || "Negro")} · ${item.size === "Única" ? "Medida única" : "Talla " + escapeHTML(item.size || "M")}</p>
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

  /* Tarjetas de prueba oficiales de Clip (sandbox).
     Clip solo ofrece modo de prueba para Checkout Transparente y Reembolsos;
     los links de pago (flujo de esta tienda) no tienen sandbox. Por eso aquí
     simulamos la respuesta con los PAN de prueba publicados por Clip. */
  const CLIP_TEST_CARDS = [
    { pan: "4766944332216006", brand: "Visa", status: "approved" },
    { pan: "5215956400364553", brand: "Mastercard", status: "approved" },
    { pan: "377770358335399", brand: "Amex", status: "approved" },
    { pan: "377770541774520", brand: "Amex", status: "rejected", reason: "Fondos insuficientes" },
    { pan: "4208312218017433", brand: "Visa", status: "rejected", reason: "Fondos insuficientes" },
    { pan: "377770520127013", brand: "Amex", status: "rejected", reason: "No autorizada por el emisor" },
  ];
  let sandboxApproved = null;
  let sandboxOrder = null;

  /* Checkout Transparente real de Clip (sandbox).
     La API Key pública se configura en clip-config.js; debe empezar con test_. */
  const clipPublicKey = String(window.LIKEHOODIE_CLIP?.publicKey || "").trim();
  const clipSandboxReady = /^test_/i.test(clipPublicKey);
  let clipSdk = null;
  let clipCard = null;
  let clipSdkPromise = null;

  function loadClipSdk() {
    if (window.ClipSDK) return Promise.resolve();
    if (clipSdkPromise) return clipSdkPromise;
    clipSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://sdk.clip.mx/js/clip-sdk.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar el SDK de Clip."));
      document.head.appendChild(script);
    });
    return clipSdkPromise;
  }

  async function mountClipCard(amount) {
    if (!clipSandboxReady || !clipCardMount) return;
    await loadClipSdk();
    if (!window.ClipSDK) throw new Error("SDK de Clip no disponible.");
    if (!clipCard) {
      clipSdk = new window.ClipSDK(clipPublicKey, { env: "prod" });
      clipCard = clipSdk.element.create("Card", {
        paymentAmount: Number(amount) || 1,
        locale: "es",
        theme: "light",
      });
      clipCard.mount("clip-card-mount");
    } else if (typeof clipCard.setAmount === "function") {
      clipCard.setAmount(Number(amount) || 1);
    }
  }

  function showClipCardError(message) {
    if (!clipCardError) return;
    clipCardError.textContent = message;
    clipCardError.hidden = false;
    clipCardError.scrollIntoView({ block: "nearest" });
  }

  function clipSandboxActive() {
    return Boolean(
      clipSandboxReady && clipCardPanel && !clipCardPanel.hidden
    );
  }

  function sandboxRequested() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sandbox") === "1" || params.get("demo") === "1") return true;
    return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  }

  function renderSandboxCards() {
    if (!sandboxCards || sandboxCards.childElementCount) return;
    CLIP_TEST_CARDS.forEach((card, index) => {
      const label = document.createElement("label");
      label.className = "sandbox-card";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "sandboxCard";
      input.value = String(index);
      input.checked = index === 0;
      const body = document.createElement("span");
      body.className = "sandbox-card__body";
      const brand = document.createElement("span");
      brand.className = "sandbox-card__brand";
      brand.textContent = card.brand;
      const pan = document.createElement("span");
      pan.className = "sandbox-card__pan";
      pan.textContent = `•••• ${card.pan.slice(-4)}`;
      const status = document.createElement("span");
      status.className =
        "sandbox-card__status " + (card.status === "approved" ? "is-ok" : "is-bad");
      status.textContent = card.status === "approved" ? "Aprobado" : "Rechazado";
      body.append(brand, pan, status);
      label.append(input, body);
      sandboxCards.appendChild(label);
    });
  }

  function updateSandboxUI() {
    if (!sandboxPay) return;
    const sandbox = sandboxRequested() && paymentProvider === "demo";
    const real = sandbox && clipSandboxReady;
    if (clipCardPanel) clipCardPanel.hidden = !real;
    sandboxPay.hidden = !sandbox || real;
    if (!sandbox) return;

    if (real) {
      mountClipCard(totals().total).catch((error) => {
        console.error("clip-sandbox: no se pudo montar el SDK.", error);
        // Si el SDK o la clave fallan, se usa el simulador local.
        if (clipCardPanel) clipCardPanel.hidden = true;
        sandboxPay.hidden = false;
        renderSandboxCards();
      });
      if (checkoutNote) {
        checkoutNote.textContent =
          "Sandbox de Clip: el pago se procesa con credenciales de prueba. No se cobra dinero real.";
      }
      return;
    }

    renderSandboxCards();
    if (checkoutNote) {
      checkoutNote.textContent =
        "Modo sandbox: simula el pago con las tarjetas de prueba de Clip. No se realiza ningún cargo real.";
    }
  }

  function selectedSandboxCard() {
    if (!checkoutForm) return CLIP_TEST_CARDS[0];
    const checked = checkoutForm.querySelector('input[name="sandboxCard"]:checked');
    if (!checked) return CLIP_TEST_CARDS[0];
    return CLIP_TEST_CARDS[Number(checked.value)] || CLIP_TEST_CARDS[0];
  }

  function showSandboxError(message) {
    if (!sandboxError) return;
    sandboxError.textContent = message;
    sandboxError.hidden = false;
    sandboxError.scrollIntoView({ block: "nearest" });
  }

  /* Guía profesional de colocación por producto y cara */
  const PLACEMENT_GUIDES = {
    hoodie: {
      front: {
        view: "Frente",
        text: "Centra el diseño en el pecho: 8–10 cm bajo la costura del cuello. Ancho máximo recomendado 30 cm.",
        hint: "Frente: pecho, 8–10 cm bajo el cuello. Arrastra el texto o el logo y ajústalo.",
      },
      back: {
        view: "Espalda",
        text: "Centra el diseño entre las costuras de los hombros: 5 cm bajo la costura del cuello. Ancho máximo recomendado 32 cm.",
        hint: "Espalda: centro entre hombros, 5 cm bajo el cuello. Arrastra y ajusta.",
      },
    },
    tote: {
      front: {
        view: "Frente",
        text: "Centra el diseño en el cuerpo de la bolsa: 5 cm bajo la costura superior. Ancho máximo recomendado 28 cm.",
        hint: "Tote: centro del cuerpo, 5 cm bajo la costura superior.",
      },
      back: {
        view: "Reverso",
        text: "Centra el diseño en el cuerpo de la bolsa: 5 cm bajo la costura superior. Ancho máximo recomendado 28 cm.",
        hint: "Reverso: centro del cuerpo, 5 cm bajo la costura superior.",
      },
    },
  };

  function updatePlacementGuide() {
    const guides = PLACEMENT_GUIDES[state.product] || PLACEMENT_GUIDES.hoodie;
    const guide = guides[state.view] || guides.front;
    if (placementView) placementView.textContent = guide.view;
    if (placementText) placementText.textContent = guide.text;
    if (hintText) hintText.textContent = guide.hint;
  }

  let activeCoord = "logo";

  function formatCoord(x, y) {
    const fx = Number.isFinite(Number(x)) ? Number(x) : 50;
    const fy = Number.isFinite(Number(y)) ? Number(y) : 50;
    const fmt = (value) => String(Math.round(value * 10) / 10).replace(".", ",");
    return `X ${fmt(fx)} % · Y ${fmt(fy)} %`;
  }

  function setActiveCoord(type) {
    activeCoord = type === "text" ? "text" : "logo";
    $$("[data-coord-row]").forEach((row) => {
      row.classList.toggle("is-active", row.dataset.coordRow === activeCoord);
    });
  }

  function updateCoords() {
    const design = state.designs[state.view];
    if (!design) return;
    if (logoCoord) logoCoord.textContent = formatCoord(design.logoX, design.logoY);
    if (textCoord) textCoord.textContent = formatCoord(design.textX, design.textY);
    if (placementStatusEl) {
      const status = placementStatusFor(activeCoord);
      placementStatusEl.textContent = status.text;
      placementStatusEl.classList.toggle("is-outside", status.outside);
    }
  }

  function placementStatusFor(type) {
    const design = state.designs[state.view];
    if (!design) return { text: "", outside: false };
    const area = PRINT_AREAS[state.product] || PRINT_AREAS.hoodie;
    const x = Number(type === "text" ? design.textX : design.logoX) || 50;
    const y = Number(type === "text" ? design.textY : design.logoY) || 50;
    const centerX = area.x + area.w / 2;
    const centerY = area.y + area.h / 2;
    const inside =
      x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h;
    const name = type === "text" ? "Texto" : "Logo";
    const fmt = (value) =>
      String(Math.round(value * 10) / 10).replace(".", ",");

    if (!inside) {
      const hints = [];
      if (x < area.x) hints.push("a la derecha");
      else if (x > area.x + area.w) hints.push("a la izquierda");
      if (y < area.y) hints.push("hacia abajo");
      else if (y > area.y + area.h) hints.push("hacia arriba");
      return {
        text: `${name} fuera del área de impresión${
          hints.length ? ` · muévelo ${hints.join(" y ")}` : ""
        }.`,
        outside: true,
      };
    }

    const dx = x - centerX;
    const dy = y - centerY;
    const horizontal =
      Math.abs(dx) < 0.6
        ? "centrado horizontal"
        : `${fmt(Math.abs(dx))} % a la ${dx > 0 ? "derecha" : "izquierda"}`;
    const vertical =
      Math.abs(dy) < 0.6
        ? "centrado vertical"
        : `${fmt(Math.abs(dy))} % ${dy > 0 ? "abajo" : "arriba"}`;
    return {
      text: `${name} dentro del área · ${horizontal} · ${vertical}.`,
      outside: false,
    };
  }

  function updateCoordBubble(element, x, y) {
    if (!element) return;
    let bubble = element.querySelector(".coord-bubble");
    if (!bubble) {
      bubble = document.createElement("span");
      bubble.className = "coord-bubble";
      bubble.setAttribute("aria-hidden", "true");
      element.appendChild(bubble);
    }
    bubble.textContent = formatCoord(x, y);
  }

  function openCheckout() {
    if (state.items.length === 0) return;
    closeCart(false);
    lastFocusedElement = document.activeElement;
    checkoutForm.reset();
    sandboxApproved = null;
    sandboxOrder = null;
    if (sandboxError) {
      sandboxError.hidden = true;
      sandboxError.textContent = "";
    }
    if (clipCardError) {
      clipCardError.hidden = true;
      clipCardError.textContent = "";
    }
    checkoutFormView.hidden = false;
    checkoutSuccess.hidden = true;
    if (checkoutSuccessTitle) checkoutSuccessTitle.textContent = "¡Pedido confirmado!";
    if (checkoutSuccessMessage) {
      checkoutSuccessMessage.textContent =
        "Gracias por confiar en like hoodie ♡. Tu pedido quedó registrado como demostración; todavía no se realiza ningún cargo. Te contactaremos cuando se active el pago real.";
    }
    if (retryPaymentButton) retryPaymentButton.hidden = true;
    updateSandboxUI();
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
    window.LikeHoodieConsent?.track("begin_checkout", {
      value: totals().total,
      currency: "MXN",
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

      /* Checkout Transparente real de Clip (sandbox) */
      if (clipSandboxActive()) {
        if (clipCardError) clipCardError.hidden = true;
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.dataset.originalLabel = submitButton.textContent;
          submitButton.textContent = "Procesando pago…";
        }

        let tokenData;
        try {
          if (!clipCard) throw new Error("El formulario de pago no está listo.");
          tokenData = await clipCard.cardToken();
        } catch (error) {
          restoreSubmitButton(submitButton);
          showClipCardError(
            error?.message || "No se pudo validar la tarjeta. Revisa los datos."
          );
          return;
        }
        if (!tokenData?.id) {
          restoreSubmitButton(submitButton);
          showClipCardError("No se pudo tokenizar la tarjeta.");
          return;
        }

        if (!sandboxOrder) {
          const saved = await analytics?.placeOrder({
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
          sandboxOrder = saved;
        }

        let result;
        try {
          result = await analytics.payClipOrder(sandboxOrder.id, tokenData.id, {
            email: customer.email,
            phone: customer.phone,
          });
        } catch (error) {
          restoreSubmitButton(submitButton);
          showClipCardError(error?.message || "No se pudo procesar el pago.");
          return;
        }

        if (result?.status === "approved") {
          state.items = [];
          state.cartStep = "cart";
          saveCart();
          renderCart();
          orderNumber.textContent = `LH-${sandboxOrder.number}`;
          showCheckoutResult(
            "Pago aprobado (Clip sandbox)",
            `Pago aprobado con Clip. Folio ${
              result.receiptNo || result.paymentId || "—"
            }. Pedido LH-${sandboxOrder.number}. Es una transacción de prueba: no se cobró dinero real.`
          );
          showToast("Pago sandbox aprobado. Pedido registrado.");
          return;
        }

        restoreSubmitButton(submitButton);
        const reason =
          result?.statusDetail?.message ||
          result?.message ||
          "revisa los datos de la tarjeta";
        showClipCardError(`Pago rechazado: ${reason}.`);
        return;
      }

      /* Simulación de pago con tarjetas de prueba de Clip */
      const sandboxCard =
        sandboxPay && !sandboxPay.hidden ? selectedSandboxCard() : null;
      if (sandboxCard) {
        if (sandboxError) sandboxError.hidden = true;
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.dataset.originalLabel = submitButton.textContent;
          submitButton.textContent = "Procesando pago…";
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        if (sandboxCard.status !== "approved") {
          restoreSubmitButton(submitButton);
          showSandboxError(
            `Pago rechazado: ${sandboxCard.reason}. Prueba con otra tarjeta de prueba.`
          );
          analytics?.track("sandbox_payment_rejected", {
            brand: sandboxCard.brand,
            reason: sandboxCard.reason,
          });
          return;
        }
        sandboxApproved = sandboxCard;
        if (submitButton) submitButton.textContent = "Guardando pedido…";
        analytics?.track("sandbox_payment_approved", {
          brand: sandboxCard.brand,
          last4: sandboxCard.pan.slice(-4),
        });
      }

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

      const baseMessage = analytics?.configured
        ? "Gracias por confiar en like hoodie ♡. Tu pedido quedó registrado como demostración; todavía no se realiza ningún cargo. Te contactaremos cuando se active el pago real."
        : "Gracias por confiar en like hoodie ♡. Tu pedido quedó registrado como demostración; todavía no se realiza ningún cargo.";
      const sandboxPrefix = sandboxApproved
        ? `Pago simulado aprobado con ${sandboxApproved.brand} •••• ${sandboxApproved.pan.slice(-4)} (sandbox de Clip). `
        : "";
      orderNumber.textContent = orderLabel;
      showCheckoutResult(
        sandboxApproved ? "Pago aprobado (sandbox)" : "¡Pedido confirmado!",
        sandboxPrefix + baseMessage
      );
      showToast(
        sandboxApproved
          ? "Pago de prueba aprobado. Pedido registrado."
          : analytics?.configured
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
      updateSandboxUI();
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
    materialLabels.forEach((label) => {
      label.textContent = state.material.name;
    });

    materialButtons.forEach((button) => {
      const active = button.dataset.material === state.material.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (materialNotes.length) {
      const delta = state.material.delta;
      const suffix =
        delta === 0
          ? " Incluido."
          : delta > 0
            ? ` +${formatPrice(delta)}.`
            : ` Ahorras ${formatPrice(Math.abs(delta))}.`;
      materialNotes.forEach((note) => {
        note.textContent = state.material.desc + suffix;
      });
    }
  }

  function updateTechniqueUI() {
    techniqueLabels.forEach((label) => {
      label.textContent = state.technique.name;
    });

    techniqueButtons.forEach((button) => {
      const active = button.dataset.technique === state.technique.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (techniqueNotes.length) {
      let suffix = " Incluido.";
      if (state.technique.price > 0) {
        suffix = hasAnyDesign()
          ? ` Se suma ${formatPrice(state.technique.price)} una vez por pedido.`
          : ` Se sumará ${formatPrice(state.technique.price)} cuando añadas texto o logo.`;
      }
      techniqueNotes.forEach((note) => {
        note.textContent = state.technique.desc + suffix;
      });
    }

    if (techniqueWarnings.length) {
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
      techniqueWarnings.forEach((element) => {
        element.hidden = !warning;
        element.textContent = warning;
      });
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
    const shell = document.querySelector(".studio-controls");
    if (shell) shell.dataset.tool = tool;
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
      const product = PRODUCTS[state.product] || PRODUCTS.hoodie;
      const imageFile = product.images[isFront ? "front" : "back"];
      const isDark = state.color.toLowerCase() === "#1c1c1f";
      hoodiePreview.style.setProperty("--fabric-color", state.color);
      hoodiePreview.style.setProperty("--tint-mask", `url("${imageFile}")`);
      hoodiePreview.classList.toggle("is-dark", isDark);
      hoodiePreview.classList.remove("is-side-view", "is-left-view");

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
        hoodiePhoto.src = imageFile;
        hoodiePhoto.alt = `Vista ${isFront ? "frontal" : "trasera"} de tu ${product.label.toLowerCase()}`;
        hoodiePhoto.width = 1003;
        hoodiePhoto.height = 1229;
      }
      if (studio) studio.classList.remove("is-side-view");
      if (personalizePanel) {
        personalizePanel.removeAttribute("inert");
        personalizePanel.removeAttribute("aria-hidden");
      }
      updatePlacementGuide();
      updateCoords();
    }

    previewNames.forEach((element) => {
      element.textContent = state.colorName;
    });

    if (previewSwatch) previewSwatch.style.background = state.color;
    const isSingleSize = state.size === "Única";
    if (previewSize) previewSize.textContent = isSingleSize ? "38×42 cm" : state.size;
    if (sizeLabelEl) sizeLabelEl.textContent = isSingleSize ? "Medidas" : "Talla";
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
        if (printLogoImg) {
          printLogoImg.src = design.logo;
          printLogoImg.alt = `Logo de la vista ${state.view === "front" ? "frontal" : "trasera"}`;
        }
        printLogo.hidden = false;
      } else {
        if (printLogoImg) {
          printLogoImg.removeAttribute("src");
          printLogoImg.alt = "";
        }
        printLogo.hidden = true;
      }
      printLogo.style.setProperty("--x", `${design.logoX}%`);
      printLogo.style.setProperty("--y", `${design.logoY}%`);
      printLogo.style.setProperty("--item-scale", design.logoScale || 1);
      printLogo.style.setProperty("--item-rotate", `${design.logoRotate || 0}deg`);
      printLogo.setAttribute(
        "aria-label",
        design.logoName
          ? `Logo "${design.logoName}". Arrastra para moverlo, usa las asas para cambiar el tamaño o rotarlo.`
          : "Logo del diseño. Arrastra para moverlo, usa las asas para cambiar el tamaño o rotarlo."
      );
    }

    const total =
      state.basePrice +
      state.material.delta +
      techniqueFee() +
      logoCount() * LOGO_PRICE +
      (state.size === "XXL" ? XXL_PRICE : 0);

    if (priceEl) priceEl.textContent = formatPrice(total);
    if (priceNote) priceNote.textContent = priceNoteText();

    updateTextColorUI();
    updateTextFontUI();
    updateMaterialUI();
    updateTechniqueUI();
    // el repintado reescribe el contenido: las asas deben volver
    setupHandles(printText);
    setupHandles(printLogo);
    updateHandleScale(printText);
    updateHandleScale(printLogo);

    syncVectorPanel();
    setPrintStatusUI(activeDesign());
    commitHistory();
  }

  function updateGalleryUI() {
    viewThumbs.forEach((button) => {
      const active = Number(button.dataset.angle) === state.angle;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  const productSelections = {};

  /* Guías de centrado: área de impresión orientativa por producto */
  const PRINT_AREAS = {
    hoodie: { x: 24, y: 15, w: 52, h: 44 },
    tote: { x: 12, y: 36, w: 76, h: 48 },
  };
  const printGrid = $("[data-print-grid]");
  const gridToggleButton = $("[data-grid-toggle]");
  const GRID_STORAGE_KEY = "lh-grid-visible";

  function applyGridArea() {
    if (!printGrid) return;
    const area = PRINT_AREAS[state.product] || PRINT_AREAS.hoodie;
    printGrid.style.setProperty("--area-x", area.x + "%");
    printGrid.style.setProperty("--area-y", area.y + "%");
    printGrid.style.setProperty("--area-w", area.w + "%");
    printGrid.style.setProperty("--area-h", area.h + "%");
  }

  function setGridVisible(visible) {
    if (!printGrid) return;
    printGrid.hidden = !visible;
    if (gridToggleButton) gridToggleButton.setAttribute("aria-pressed", String(visible));
    try {
      localStorage.setItem(GRID_STORAGE_KEY, visible ? "1" : "0");
    } catch (error) {
      /* almacenamiento no disponible */
    }
  }

  if (gridToggleButton) {
    gridToggleButton.addEventListener("click", () => {
      setGridVisible(gridToggleButton.getAttribute("aria-pressed") !== "true");
    });
  }

  applyGridArea();
  let gridVisible = true;
  try {
    gridVisible = localStorage.getItem(GRID_STORAGE_KEY) !== "0";
  } catch (error) {
    /* almacenamiento no disponible */
  }
  setGridVisible(gridVisible);

  function setProduct(id) {
    const next = PRODUCTS[id] ? id : "hoodie";
    if (state.product !== next) {
      productSelections[state.product] = {
        size: state.size,
        material: { ...state.material },
        technique: { ...state.technique },
      };
    }
    const product = PRODUCTS[next];
    const saved = productSelections[next];
    state.product = next;
    applyGridArea();
    state.basePrice = product.prices[state.color] || product.fallbackPrice;
    state.size = saved ? saved.size : product.defaults.size;
    state.material = saved ? { ...saved.material } : { ...product.defaults.material };
    state.technique = saved ? { ...saved.technique } : { ...product.defaults.technique };

    productTabs.forEach((button) => {
      const active = button.dataset.productTab === state.product;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    productPanels.forEach((panel) => {
      panel.hidden = panel.dataset.productPanel !== state.product;
    });

    sizeButtons.forEach((button) => {
      const active = button.dataset.size === state.size;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    galleryThumbs.forEach((image, index) => {
      image.src = index === 0 ? product.images.front : product.images.back;
    });

    updateMaterialUI();
    updateTechniqueUI();
    updatePreview();
  }

  function setAngle(angle) {
    const normalized = ((Number(angle) % 360) + 360) % 360;
    setView(normalized >= 135 && normalized < 315 ? "back" : "front");
  }

  function setView(view) {
    if (!state.designs[view]) return;
    state.view = view;
    state.angle = view === "front" ? 0 : 180;
    updateGalleryUI();

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
    const product = PRODUCTS[state.product] || PRODUCTS.hoodie;
    state.basePrice = product.prices[hex] || product.fallbackPrice || state.basePrice;

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
      const next = Math.min(max, Math.max(min, Math.round(value * 100) / 100));
      design()[scaleKey] = next;
      element.style.setProperty("--item-scale", next);
      updateHandleScale(element);
      if (input) input.value = String(Math.round(next * 100));
      if (output) output.textContent = Math.round(next * 100) + "%";
    }

    function setRotate(value) {
      let next = value;
      while (next > 180) next -= 360;
      while (next < -180) next += 360;
      design()[rotateKey] = Math.round(next);
      element.style.setProperty("--item-rotate", Math.round(next) + "deg");
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

    const toolbar = document.createElement("span");
    toolbar.className = "item-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Acciones del elemento");
    toolbar.innerHTML = `
      <button type="button" data-item-action="center" aria-label="Centrar en el área" title="Centrar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke-linecap="round"/><circle cx="12" cy="12" r="3.2"/></svg>
      </button>
      ${
        type === "text"
          ? `<button type="button" data-item-action="copy" aria-label="Copiar al otro lado" title="Copiar al otro lado">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9" stroke-linecap="round"/></svg>
            </button>`
          : ""
      }
      <button type="button" data-item-action="delete" aria-label="Eliminar elemento" title="Eliminar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    `;
    toolbar.addEventListener("pointerdown", (event) => event.stopPropagation());
    toolbar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-item-action]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      runItemAction(type, button.dataset.itemAction);
    });
    element.appendChild(toolbar);

    if (handleSizeObserver) handleSizeObserver.observe(element);
  }

  function setupDraggable(element) {
    if (!element) return;
    const type = element.dataset.printType;
    if (!type) return;

    let dragging = false;
    let dragSide = "front";

    const applyPosition = (design) => {
      const posX = type === "text" ? design.textX : design.logoX;
      const posY = type === "text" ? design.textY : design.logoY;
      element.style.setProperty("--x", `${posX}%`);
      element.style.setProperty("--y", `${posY}%`);
      updateCoordBubble(element, posX, posY);
      updateCoords();
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
      setActiveCoord(type);
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

      setActiveCoord(type);
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
    button.addEventListener("click", () => {
      const tool = button.dataset.personalizeTool;
      setTool(tool);
      if (tool === "texto") setActiveCoord("text");
      if (tool === "logo") setActiveCoord("logo");
    });
  });

  viewThumbs.forEach((button) => {
    button.addEventListener("click", () => setAngle(button.dataset.angle));
  });

  productTabs.forEach((button) => {
    button.addEventListener("click", () => setProduct(button.dataset.productTab));
  });

  if (textInput) {
    textInput.addEventListener("input", () => {
      setActiveCoord("text");
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

  /* ---------------------------------------------------------------------- */
  /* Vectorizado de logo (prototipo en el dispositivo)                      */
  /* ---------------------------------------------------------------------- */

  const VECTOR_HINTS = {
    serigrafia: {
      copy: "Serigrafía necesita tintas planas: usa el modo 1 tinta para una silueta limpia.",
      badge: "Recomendado",
      level: "recommended",
    },
    vinilo: {
      copy: "El vinilo se corta: el archivo debe ser vector y de un solo color.",
      badge: "Recomendado",
      level: "recommended",
    },
    bordado: {
      copy: "El bordado se digitaliza aparte; el vector sirve como contorno de referencia.",
      badge: "Apoyo",
      level: "support",
    },
    sublimacion: {
      copy: "En sublimación el color depende del tejido; el vector ayuda en logos planos.",
      badge: "Opcional",
      level: "optional",
    },
    dtf: {
      copy: "DTF trabaja con PNG a 300 DPI: el vector ayuda a escalar sin perder nitidez.",
      badge: "Opcional",
      level: "optional",
    },
    dtg: {
      copy: "DTG imprime el raster original. Vectoriza solo si el logo llega borroso o muy pequeño.",
      badge: "Opcional",
      level: "optional",
    },
  };

  let vectorKey = "";
  let vectorBusy = false;

  function vectorPreferredMode() {
    const hint = VECTOR_HINTS[state.technique.id];
    return hint && hint.level === "recommended" ? "mono" : "color";
  }

  function vectorSource(design) {
    return design.logoRaster || design.logo || "";
  }

  function renderVectorResult(design) {
    if (!vectorResultEl) return;
    const result = design.logoVectorResult;
    vectorResultEl.hidden = !result;
    if (!result) return;

    if (vectorOriginal) vectorOriginal.src = vectorSource(design) || "";
    if (vectorOutput) vectorOutput.src = result.dataUrl;

    if (vectorStats) {
      vectorStats.replaceChildren();
      const items = [
        `${result.metrics.colors} ${result.metrics.colors === 1 ? "color" : "colores"}`,
        `${result.metrics.paths.toLocaleString("es-MX")} trazos`,
        `${Math.max(1, Math.round(result.metrics.bytes / 1024))} KB`,
        `${result.print.dpi} DPI de origen`,
        `${result.elapsed} ms`,
      ];
      items.forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        vectorStats.appendChild(item);
      });
    }

    if (vectorVerdict) {
      vectorVerdict.textContent = result.quality.reasons.join(" ");
      vectorVerdict.dataset.level = result.quality.level;
    }

    if (vectorApply) vectorApply.hidden = Boolean(design.logoIsVector);
    if (vectorRevert) vectorRevert.hidden = !design.logoIsVector;
  }

  function syncVectorPanel(force) {
    if (!vectorPanel) return;

    const design = activeDesign();
    if (!design.logo) {
      vectorPanel.hidden = true;
      vectorKey = "";
      return;
    }

    if (!design.vectorMode) design.vectorMode = vectorPreferredMode();

    const key = [
      state.view,
      design.logoName,
      design.logoIsVector ? "vector" : "raster",
      design.logoVectorResult ? "result" : "none",
      state.technique.id,
    ].join("|");
    if (!force && key === vectorKey) return;
    vectorKey = key;

    vectorPanel.hidden = false;

    const hint = VECTOR_HINTS[state.technique.id] || VECTOR_HINTS.dtg;
    if (vectorHint) vectorHint.textContent = hint.copy;
    if (vectorBadge) {
      vectorBadge.textContent = hint.badge;
      vectorBadge.dataset.level = hint.level;
    }

    vectorModeButtons.forEach((button) => {
      const active = button.dataset.vectorMode === design.vectorMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    renderVectorResult(design);
  }

  async function runVectorizer() {
    if (vectorBusy) return;

    const design = activeDesign();
    if (!design.logo) return;

    if (!window.LikeVectorize) {
      showToast("El vectorizador no está disponible en este navegador.");
      return;
    }

    const source = vectorSource(design);
    vectorBusy = true;
    if (vectorRunButton) {
      vectorRunButton.disabled = true;
      vectorRunButton.classList.add("is-busy");
      vectorRunButton.setAttribute("aria-busy", "true");
    }
    if (vectorRunLabel) vectorRunLabel.textContent = "Vectorizando…";
    if (vectorStatus) {
      vectorStatus.hidden = false;
      vectorStatus.dataset.state = "busy";
      vectorStatus.textContent = "Analizando formas y colores…";
    }

    // Deja pintar el estado de carga antes del trabajo pesado.
    await new Promise((resolve) => window.setTimeout(resolve, 60));

    try {
      const result = await window.LikeVectorize.vectorize(source, {
        mode: design.vectorMode || "color",
        garment: state.color,
      });

      if (vectorSource(design) !== source) return;

      design.logoVectorResult = result;
      renderVectorResult(design);

      if (vectorStatus) {
        vectorStatus.dataset.state = result.quality.level === "bad" ? "warn" : "ok";
        vectorStatus.textContent =
          result.quality.level === "good"
            ? "Vector listo."
            : "Vector generado: revisa el resultado antes de usarlo.";
      }
    } catch (error) {
      if (vectorStatus) {
        vectorStatus.dataset.state = "error";
        vectorStatus.textContent =
          error && error.message ? error.message : "No se pudo vectorizar el logo.";
      }
    } finally {
      vectorBusy = false;
      if (vectorRunButton) {
        vectorRunButton.disabled = false;
        vectorRunButton.classList.remove("is-busy");
        vectorRunButton.setAttribute("aria-busy", "false");
      }
      if (vectorRunLabel) vectorRunLabel.textContent = "Vectorizar de nuevo";
    }
  }

  if (vectorRunButton) {
    vectorRunButton.addEventListener("click", runVectorizer);
  }

  vectorModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const design = activeDesign();
      const mode = button.dataset.vectorMode === "mono" ? "mono" : "color";
      if (design.vectorMode === mode) return;

      design.vectorMode = mode;
      if (design.logoVectorResult && design.logoVectorResult.mode !== mode) {
        design.logoVectorResult = null;
      }
      if (vectorStatus) vectorStatus.hidden = true;
      syncVectorPanel(true);
    });
  });

  if (vectorApply) {
    vectorApply.addEventListener("click", () => {
      const design = activeDesign();
      if (!design.logoVectorResult) return;

      design.logoRaster = design.logoRaster || design.logo;
      design.logo = design.logoVectorResult.dataUrl;
      design.logoIsVector = true;
      updatePreview();
      showToast("Vector aplicado al diseño.");
    });
  }

  if (vectorRevert) {
    vectorRevert.addEventListener("click", () => {
      const design = activeDesign();
      if (!design.logoRaster) return;

      design.logo = design.logoRaster;
      design.logoIsVector = false;
      updatePreview();
      showToast("Logo original restaurado.");
    });
  }

  if (vectorDownload) {
    vectorDownload.addEventListener("click", () => {
      const design = activeDesign();
      if (!design.logoVectorResult) return;

      const blob = new Blob([design.logoVectorResult.svg], {
        type: "image/svg+xml",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(design.logoName || "logo").replace(/\.[^.]+$/, "")}-vector.svg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Archivo de impresión (Edge Function en dos etapas)                     */
  /* ---------------------------------------------------------------------- */

  const PRINT_WIDTH_CM = {
    hoodie: { front: 24, back: 28 },
    tote: { front: 30, back: 30 },
  };

  const PRINT_STATUS_TEXT = {
    queued: "En cola para preparar el archivo de impresión…",
    cutout: "Quitando el fondo del logo…",
    cutout_ready: "Ajustando la resolución de impresión…",
    resizing: "Ajustando la resolución de impresión…",
    ready: "Archivo de impresión listo",
    review: "Archivo listo con revisión manual",
    failed: "No se pudo preparar el archivo de impresión",
  };

  function printWidthFor(product, side) {
    const spec = PRINT_WIDTH_CM[product] || PRINT_WIDTH_CM.hoodie;
    return side === "back" ? spec.back : spec.front;
  }

  function setPrintStatusUI(design) {
    if (!printStatus) return;
    if (!design || !design.printStatus) {
      printStatus.hidden = true;
      return;
    }

    printStatus.hidden = false;
    printStatus.dataset.state = design.printStatus;

    let text = PRINT_STATUS_TEXT[design.printStatus] || "";
    if (design.printStatus === "ready" && design.printDpi) {
      text += ` · ${design.printDpi} DPI`;
    }
    if (design.printStatus === "failed" && design.printError) {
      text += `: ${design.printError}`;
    }
    if (printStatusText) printStatusText.textContent = text;
    if (printRetry) {
      printRetry.hidden = !(
        design.printStatus === "failed" && design.logoAssetId
      );
    }
  }

  function pollPrintAsset(design, attempt) {
    const api = window.StoreSupabase;
    if (!api || !api.getLogoAsset || !design.logoAssetId) return;
    const assetId = design.logoAssetId;
    let round = Number(attempt) || 0;

    const tick = async () => {
      const asset = await api.getLogoAsset(assetId);
      if (!asset) {
        if (round < 30) {
          round += 1;
          window.setTimeout(tick, 2500);
        }
        return;
      }
      if (design.logoAssetId !== assetId) return;

      design.printStatus = asset.status;
      design.printPath = asset.print_path || "";
      design.printDpi = asset.output_dpi || null;
      design.printError = asset.last_error || "";
      setPrintStatusUI(design);

      if (asset.status === "cutout_ready") {
        await api.processLogoAsset(assetId, "resize");
      }

      const finished = ["ready", "review", "failed"].includes(asset.status);
      if (!finished && round < 60) {
        round += 1;
        window.setTimeout(tick, 2000);
      } else if (!finished) {
        design.printStatus = "failed";
        design.printError = "Tiempo de espera agotado.";
        setPrintStatusUI(design);
      }
    };

    window.setTimeout(tick, round === 0 ? 600 : 0);
  }

  async function startPrintAsset(design, sourcePath, side) {
    const api = window.StoreSupabase;
    if (!api || !api.createLogoAsset) return;
    if (api.configured === false) {
      design.printStatus = "";
      setPrintStatusUI(design);
      return;
    }

    design.logoAssetId = "";
    design.printStatus = "queued";
    design.printPath = "";
    design.printDpi = null;
    design.printError = "";
    design.printWidthCm = printWidthFor(state.product, side);
    setPrintStatusUI(design);

    const asset = await api.createLogoAsset({
      sourcePath,
      side,
      product: state.product,
      widthCm: design.printWidthCm,
    });

    if (!asset) {
      design.printStatus = "failed";
      design.printError = "No se pudo registrar el archivo.";
      setPrintStatusUI(design);
      return;
    }

    design.logoAssetId = asset.id;
    design.printStatus = asset.status || "queued";
    setPrintStatusUI(design);

    await api.processLogoAsset(asset.id, "cutout");
    pollPrintAsset(design, 1);
  }

  async function webpToPngFile(file, dataUrl) {
    if (!file || file.type !== "image/webp") return file;
    const image = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
    if (!image) return file;

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", {
      type: "image/png",
    });
  }

  if (printRetry) {
    printRetry.addEventListener("click", async () => {
      const design = activeDesign();
      if (!design.logoAssetId) return;
      design.printStatus = "queued";
      design.printError = "";
      setPrintStatusUI(design);
      await window.StoreSupabase?.processLogoAsset(
        design.logoAssetId,
        "cutout"
      );
      pollPrintAsset(design, 1);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Historial, atajos y acciones del elemento                              */
  /* ---------------------------------------------------------------------- */

  const HISTORY_LIMIT = 50;
  let historyStack = [];
  let historyIndex = -1;
  let historyTimer = null;
  let historySuspended = false;
  let lastHistorySignature = "";

  function designSignature() {
    return JSON.stringify(
      ["front", "back"].map((side) => {
        const design = state.designs[side];
        return [
          design.text,
          design.textColor,
          design.textScale,
          design.textFont,
          design.textX,
          design.textY,
          design.textRotate || 0,
          design.logoName,
          design.logoPath,
          design.logoIsVector ? 1 : 0,
          design.logoScale,
          design.logoX,
          design.logoY,
          design.logoRotate || 0,
          design.logoAssetId,
        ];
      })
    );
  }

  function snapshotDesigns() {
    const snapshot = {};
    ["front", "back"].forEach((side) => {
      const copy = { ...state.designs[side] };
      delete copy.logoVectorResult;
      snapshot[side] = copy;
    });
    return snapshot;
  }

  function updateHistoryButtons() {
    if (undoButton) undoButton.disabled = historyIndex <= 0;
    if (redoButton) {
      redoButton.disabled = historyIndex >= historyStack.length - 1;
    }
  }

  function commitHistory() {
    if (historySuspended) return;
    if (historyTimer) window.clearTimeout(historyTimer);
    historyTimer = window.setTimeout(() => {
      historyTimer = null;
      const signature = designSignature();
      if (signature === lastHistorySignature) return;
      if (historyIndex < historyStack.length - 1) {
        historyStack = historyStack.slice(0, historyIndex + 1);
      }
      historyStack.push(snapshotDesigns());
      if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
      historyIndex = historyStack.length - 1;
      lastHistorySignature = signature;
      updateHistoryButtons();
    }, 320);
  }

  function resetHistory() {
    if (historyTimer) window.clearTimeout(historyTimer);
    historyTimer = null;
    historyStack = [snapshotDesigns()];
    historyIndex = 0;
    lastHistorySignature = designSignature();
    updateHistoryButtons();
  }

  function applyHistory(snapshot) {
    if (!snapshot) return;
    historySuspended = true;
    if (historyTimer) {
      window.clearTimeout(historyTimer);
      historyTimer = null;
    }
    ["front", "back"].forEach((side) => {
      const live = state.designs[side];
      const restored = { ...snapshot[side] };
      const sameLogo =
        Boolean(restored.logo) &&
        Boolean(live.logo) &&
        live.logoName === restored.logoName &&
        live.logoPath === restored.logoPath;
      if (sameLogo) {
        restored.logoAssetId = live.logoAssetId;
        restored.printStatus = live.printStatus;
        restored.printPath = live.printPath;
        restored.printDpi = live.printDpi;
        restored.printWidthCm = live.printWidthCm;
        restored.printError = live.printError;
      }
      state.designs[side] = restored;
    });
    lastHistorySignature = designSignature();
    setView(state.view);
    historySuspended = false;
    updateHistoryButtons();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    applyHistory(historyStack[historyIndex]);
  }

  function redo() {
    if (historyIndex >= historyStack.length - 1) return;
    historyIndex += 1;
    applyHistory(historyStack[historyIndex]);
  }

  function copyTextToOtherSide() {
    const design = activeDesign();
    if (!design.text) {
      showToast("Escribe algo primero.");
      return;
    }
    const otherSide = state.view === "front" ? "back" : "front";
    const other = state.designs[otherSide];
    const defaults = DEFAULT_POSITIONS[otherSide] || DEFAULT_POSITIONS.front;
    other.text = design.text;
    other.textColor = design.textColor;
    other.textScale = design.textScale;
    other.textFont = design.textFont;
    other.textRotate = design.textRotate || 0;
    other.textX = 50;
    other.textY = defaults.textY;
    updatePreview();
    showToast(
      `Texto copiado a la ${otherSide === "front" ? "frente" : "espalda"}.`
    );
  }

  function deleteElement(type) {
    if (type === "logo") {
      removeLogoButton?.click();
      return;
    }
    const design = activeDesign();
    if (!design.text) return;
    design.text = "";
    if (textInput) textInput.value = "";
    if (charCount) charCount.textContent = "0";
    updatePreview();
    showToast("Texto eliminado.");
  }

  function deleteActiveItem() {
    if (activeCoord === "text") {
      deleteElement("text");
    } else if (activeDesign().logo) {
      deleteElement("logo");
    }
  }

  function nudgeActive(dx, dy) {
    const design = activeDesign();
    if (activeCoord === "text") {
      if (!design.text) return;
      design.textX = clampPosition((design.textX || 50) + dx, "text", "x");
      design.textY = clampPosition((design.textY || 49) + dy, "text", "y");
    } else {
      if (!design.logo) return;
      design.logoX = clampPosition((design.logoX || 50) + dx, "logo", "x");
      design.logoY = clampPosition((design.logoY || 32) + dy, "logo", "y");
    }
    updatePreview();
  }

  function runItemAction(type, action) {
    const design = activeDesign();
    if (action === "center") {
      const defaults = DEFAULT_POSITIONS[state.view] || DEFAULT_POSITIONS.front;
      if (type === "text") {
        design.textX = 50;
        design.textY = defaults.textY;
      } else {
        design.logoX = 50;
        design.logoY = defaults.logoY;
      }
      updatePreview();
      showToast("Elemento centrado.");
      return;
    }
    if (action === "copy" && type === "text") {
      copyTextToOtherSide();
      return;
    }
    if (action === "delete") {
      deleteElement(type);
    }
  }

  if (undoButton) undoButton.addEventListener("click", undo);
  if (redoButton) redoButton.addEventListener("click", redo);

  if (guideToggle) {
    guideToggle.addEventListener("click", () => {
      const guide = guideToggle.closest(".placement-guide");
      if (!guide) return;
      const collapsed = guide.classList.toggle("is-collapsed");
      guideToggle.setAttribute("aria-expanded", String(!collapsed));
      guideToggle.textContent = collapsed ? "Ver guía" : "Ocultar";
    });
  }

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const element = target instanceof Element ? target : null;
    const editing = Boolean(
      element &&
        (element.matches("input, textarea, select") || element.isContentEditable)
    );
    const mod = event.ctrlKey || event.metaKey;
    const key = String(event.key || "").toLowerCase();

    if (mod && key === "z") {
      if (editing) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === "y") {
      if (editing) return;
      event.preventDefault();
      redo();
      return;
    }
    if (mod && key === "d") {
      if (editing) return;
      event.preventDefault();
      copyTextToOtherSide();
      return;
    }
    if (editing) return;

    if (event.key === "Delete" || event.key === "Backspace") {
      if (!activeDesign().text && !activeDesign().logo) return;
      event.preventDefault();
      deleteActiveItem();
      return;
    }

    const arrows = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (arrows[event.key] && !element?.closest(".editor-item")) {
      event.preventDefault();
      const step = event.shiftKey ? 2 : 0.5;
      nudgeActive(arrows[event.key][0] * step, arrows[event.key][1] * step);
    }
  });

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
      reader.readAsDataURL(file);
    });
  }

  async function applyLogoFile(file, side) {
    if (!file) return false;
    const targetSide = side === "back" ? "back" : "front";

    if (!LOGO_TYPES.includes(file.type)) {
      showToast("Formato no válido. Usa PNG, JPG o WebP.");
      return false;
    }

    if (file.size > LOGO_MAX_BYTES) {
      showToast("El logo no puede superar los 5 MB.");
      return false;
    }

    let source;
    try {
      source = await readFileAsDataURL(file);
    } catch (error) {
      showToast("No hemos podido leer el archivo. Inténtalo de nuevo.");
      return false;
    }

    const design = state.designs[targetSide];
    setActiveCoord("logo");
    design.logo = source;
    design.logoName = file.name;
    design.logoPath = "";
    design.logoData = await prepareLogoData(source, file.type);
    design.logoRaster = source;
    design.logoIsVector = false;
    design.logoVectorResult = null;
    design.vectorMode = "";
    design.logoAssetId = "";
    design.printStatus = "";
    design.printPath = "";
    design.printDpi = null;
    design.printWidthCm = null;
    design.printError = "";
    vectorKey = "";

    if (state.view === targetSide) {
      if (uploadFile) uploadFile.hidden = false;
      if (fileName) fileName.textContent = file.name;
    }
    updatePreview();
    showToast(
      `Logo ${targetSide === "front" ? "frontal" : "trasero"} cargado.`
    );

    if (window.StoreSupabase?.uploadLogo) {
      const printable = await webpToPngFile(file, source);
      const path = await window.StoreSupabase.uploadLogo(printable, targetSide);
      if (path && design.logo === source) {
        design.logoPath = path;
        design.logoData = "";
        startPrintAsset(design, path, targetSide).catch(() => undefined);
      }
    }

    return true;
  }

  if (logoInput) {
    logoInput.addEventListener("change", async () => {
      const file = logoInput.files && logoInput.files[0];
      if (!file) return;
      await applyLogoFile(file, state.view);
      logoInput.value = "";
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Modelos de la colección                                                */
  /* ---------------------------------------------------------------------- */

  const MODELS = {
    cocodrilo: {
      product: "hoodie",
      color: "#ffffff",
      colorName: "Blanco",
      side: "front",
      logo: "assets/modelos/cocodrilo-logo.png",
      fileName: "cocodrilo-miami.png",
    },
    insignia: {
      product: "hoodie",
      color: "#1c1c1f",
      colorName: "Negro",
      side: "front",
      logo: "assets/modelos/insignia-logo.png",
      fileName: "insignia-atardecer.png",
    },
    panorama: {
      product: "hoodie",
      color: "#1c1c1f",
      colorName: "Negro",
      side: "front",
      logo: "assets/modelos/panorama-logo.png",
      fileName: "panorama-vice.png",
    },
    corazon: {
      product: "hoodie",
      color: "#1c1c1f",
      colorName: "Negro",
      side: "front",
      logo: "assets/modelos/corazon-logo.png",
      fileName: "corazon-neon.png",
    },
  };

  async function applyModel(id) {
    const model = MODELS[id];
    if (!model) return;

    setProduct(model.product);
    selectColor(model.color, model.colorName);
    setView(model.side);

    const section = document.getElementById("personalizar");
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    try {
      const response = await fetch(model.logo, { cache: "force-cache" });
      if (!response.ok) throw new Error("No se pudo cargar el logo.");
      const blob = await response.blob();
      const file = new File([blob], model.fileName, {
        type: blob.type || "image/png",
      });
      await applyLogoFile(file, model.side);
    } catch (error) {
      showToast("No se pudo cargar el modelo. Inténtalo de nuevo.");
    }
  }

  document.querySelectorAll("[data-model]").forEach((button) => {
    button.addEventListener("click", () => {
      applyModel(button.dataset.model);
    });
  });

  if (removeLogoButton) {
    removeLogoButton.addEventListener("click", () => {
      const design = activeDesign();
      design.logo = null;
      design.logoName = "";
      design.logoPath = "";
      design.logoData = "";
      design.logoRaster = "";
      design.logoIsVector = false;
      design.logoVectorResult = null;
      design.vectorMode = "";
      design.logoAssetId = "";
      design.printStatus = "";
      design.printPath = "";
      design.printDpi = null;
      design.printWidthCm = null;
      design.printError = "";
      vectorKey = "";
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

  /* Zoom y desplazamiento de la prenda dentro del estudio */
  const hoodieStage = $(".hoodie-stage");
  const studioHoodie = $("[data-preview-hoodie]");
  const zoomInButton = $("[data-zoom-in]");
  const zoomOutButton = $("[data-zoom-out]");
  const zoomResetButton = $("[data-zoom-reset]");
  const zoomValueEl = $("[data-zoom-value]");

  function applyStudioZoom() {
    if (!studioHoodie) return;
    const maxX = (studioHoodie.offsetWidth * (zoomLevel - 1)) / 2;
    const maxY = (studioHoodie.offsetHeight * (zoomLevel - 1)) / 2;
    zoomPanX = Math.max(-maxX, Math.min(maxX, zoomPanX));
    zoomPanY = Math.max(-maxY, Math.min(maxY, zoomPanY));
    if (zoomLevel <= 1.001) {
      zoomPanX = 0;
      zoomPanY = 0;
    }
    studioHoodie.style.setProperty("--zoom", zoomLevel);
    studioHoodie.style.transform = `translate(${zoomPanX}px, ${zoomPanY}px) scale(${zoomLevel})`;
    updateHandleScale(printText);
    updateHandleScale(printLogo);
    if (zoomValueEl) zoomValueEl.textContent = Math.round(zoomLevel * 100) + "%";
    if (zoomInButton) zoomInButton.disabled = zoomLevel >= 2.499;
    if (zoomOutButton) zoomOutButton.disabled = zoomLevel <= 1.001;
    if (hoodieStage) hoodieStage.classList.toggle("is-zoomed", zoomLevel > 1.001);
    if (zoomResetButton) zoomResetButton.disabled = zoomLevel <= 1.001;
  }

  function setStudioZoom(next) {
    zoomLevel = Math.max(1, Math.min(2.5, Math.round(next * 100) / 100));
    applyStudioZoom();
  }

  // Zoom hacia el punto bajo el cursor: el contenido no "salta" al acercar
  function zoomAt(next, clientX, clientY) {
    if (!hoodieStage) return;
    const target = Math.max(1, Math.min(2.5, Math.round(next * 100) / 100));
    const rect = hoodieStage.getBoundingClientRect();
    const cx = clientX - (rect.left + rect.width / 2);
    const cy = clientY - (rect.top + rect.height / 2);
    const lx = (cx - zoomPanX) / zoomLevel;
    const ly = (cy - zoomPanY) / zoomLevel;
    zoomLevel = target;
    zoomPanX = cx - lx * target;
    zoomPanY = cy - ly * target;
    applyStudioZoom();
  }

  if (zoomInButton) zoomInButton.addEventListener("click", () => setStudioZoom(zoomLevel + 0.25));
  if (zoomOutButton) zoomOutButton.addEventListener("click", () => setStudioZoom(zoomLevel - 0.25));
  if (zoomResetButton) {
    zoomResetButton.addEventListener("click", () => {
      zoomPanX = 0;
      zoomPanY = 0;
      setStudioZoom(1);
    });
  }

  if (hoodieStage) {
    hoodieStage.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        zoomAt(zoomLevel + (event.deltaY < 0 ? 0.15 : -0.15), event.clientX, event.clientY);
      },
      { passive: false }
    );
  }

  let studioPan = null;
  if (hoodieStage) {
    hoodieStage.addEventListener("pointerdown", (event) => {
      if (zoomLevel <= 1.001) return;
      if (event.target.closest(".stage-zoom, button, a, input, .edit-handle, .editor-item")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      studioPan = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: zoomPanX,
        panY: zoomPanY,
      };
      hoodieStage.classList.add("is-panning");
      try {
        hoodieStage.setPointerCapture(event.pointerId);
      } catch (error) {
        /* puntero sintético */
      }
    });

    hoodieStage.addEventListener("pointermove", (event) => {
      if (!studioPan || event.pointerId !== studioPan.id) return;
      zoomPanX = studioPan.panX + (event.clientX - studioPan.x);
      zoomPanY = studioPan.panY + (event.clientY - studioPan.y);
      applyStudioZoom();
    });

    const stopStudioPan = (event) => {
      if (!studioPan) return;
      studioPan = null;
      hoodieStage.classList.remove("is-panning");
      try {
        hoodieStage.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* la captura pudo perderse */
      }
    };
    hoodieStage.addEventListener("pointerup", stopStudioPan);
    hoodieStage.addEventListener("pointercancel", stopStudioPan);

    hoodieStage.addEventListener("dblclick", (event) => {
      if (event.target.closest(".stage-zoom, button, a, input, .edit-handle, .editor-item")) return;
      zoomPanX = 0;
      zoomPanY = 0;
      setStudioZoom(1);
    });
  }

  applyStudioZoom();
  window.addEventListener("resize", applyStudioZoom);

  setupDraggable(printText);
  setupDraggable(printLogo);
  setupHandles(printText);
  setupHandles(printLogo);

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
          logoIsVector: Boolean(front.logoIsVector),
          logoAssetId: front.logoAssetId || "",
          printStatus: front.printStatus || "",
          printDpi: front.printDpi || null,
          printPath: front.printPath || "",
          printWidthCm: front.printWidthCm || null,
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
          logoIsVector: Boolean(back.logoIsVector),
          logoAssetId: back.logoAssetId || "",
          printStatus: back.printStatus || "",
          printDpi: back.printDpi || null,
          printPath: back.printPath || "",
          printWidthCm: back.printWidthCm || null,
          logoScale: back.logoScale,
          logoRotate: back.logoRotate || 0,
          textX: back.textX,
          textY: back.textY,
          logoX: back.logoX,
          logoY: back.logoY,
        },
        basePrice: state.basePrice,
        product: state.product,
      };
      const keySnapshot = {
        ...designSnapshot,
        front: {
          ...designSnapshot.front,
          logoData: "",
          logoPath: "",
          logoAssetId: "",
          printStatus: "",
          printPath: "",
          printDpi: null,
          printWidthCm: null,
        },
        back: {
          ...designSnapshot.back,
          logoData: "",
          logoPath: "",
          logoAssetId: "",
          printStatus: "",
          printPath: "",
          printDpi: null,
          printWidthCm: null,
        },
      };
      const key = JSON.stringify(keySnapshot);

      const existing = state.items.find((item) => item.key === key);
      if (existing) {
        existing.qty += 1;
      } else {
        state.items.push({
          id: uid(),
          key,
          product: state.product,
          name: PRODUCTS[state.product].itemName,
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
      window.LikeHoodieConsent?.track("add_to_cart", {
        value: unitPrice,
        currency: "MXN",
        content_name: PRODUCTS[state.product].itemName,
        content_type: "product",
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
        window.LikeHoodieConsent?.track("newsletter_signup", { method: "club" });
        form.reset();

        if (result.sent) {
          // doble opt-in: el código llega al confirmar el correo
          const check = document.createElement("div");
          check.className = "newsletter-success";
          check.innerHTML =
            "<strong>Revisa tu correo.</strong> Te enviamos un enlace para confirmar tu alta y recibir el 10 %. Si en un minuto no lo ves, mira en spam.";
          form.replaceWith(check);
          showToast("Te enviamos un correo para confirmar tu alta.");
          return;
        }

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
  /* Barra de compra del configurador (móvil)                                */
  /* ---------------------------------------------------------------------- */

  const studioSection = $(".studio");
  const studioSummary = $(".studio-summary");

  if (studioSection && studioSummary) {
    if ("IntersectionObserver" in window) {
      const summaryObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            studioSummary.classList.toggle("is-visible", entry.isIntersecting);
          });
        },
        { threshold: 0, rootMargin: "-12% 0px 0px 0px" }
      );

      summaryObserver.observe(studioSection);
    } else {
      studioSummary.classList.add("is-visible");
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Inicio                                                                  */
  /* ---------------------------------------------------------------------- */

  selectColor(state.color, state.colorName);
  setView(state.view);
  setTool("producto");
  resetHistory();
  renderCart();
  window.StoreSupabase?.init();
  if (state.items.length) {
    window.StoreSupabase?.syncCart(state.items, "cart");
  }
  loadPaymentConfig();
  initPaymentBanner();
})();

/* --------------------------------------------------------------------------
   Modales: cierre por arrastre desde el asa superior (hoja en móvil)
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
        /* puntero sintético */
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
