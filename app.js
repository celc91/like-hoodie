/* ==========================================================================
   Chama — Lógica de tienda (carrito, configurador y checkout de demo)
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
  const STORAGE_KEY = "chama_cart_v1";

  const BASE_PRICES = {
    "#1c1c1f": 899,
    "#efe6d6": 949,
    "#cdf25a": 969,
    "#f2603c": 949,
    "#26324f": 899,
    "#efb7c4": 899,
  };

  const state = {
    color: "#1c1c1f",
    colorName: "Negro",
    basePrice: 899,
    size: "M",
    text: "",
    textColor: "#fffdf8",
    logo: null,
    logoName: "",
    items: loadCart(),
  };

  /* ---------------------------------------------------------------------- */
  /* Utilidades                                                              */
  /* ---------------------------------------------------------------------- */

  function loadCart() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
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
    const shipping =
      subtotal === 0 || subtotal >= FREE_SHIPPING ? 0 : SHIPPING_COST;
    return { subtotal, shipping, total: subtotal + shipping };
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

  const sizeModal = $("[data-size-modal]");

  const hoodiePreview = $("[data-preview-hoodie]");
  const previewNames = $$("[data-preview-color-name]");
  const previewSwatch = $("[data-preview-swatch]");
  const previewSize = $("[data-preview-size]");
  const printArea = $("[data-print-area]");
  const printText = $("[data-print-text]");
  const printLogo = $("[data-print-logo]");
  const colorSwatches = $$(".swatch");
  const sizeButtons = $$(".size");
  const textInput = $("[data-text-input]");
  const charCount = $("[data-char-count]");
  const textColorButtons = $$(".text-color");
  const logoInput = $("[data-logo-input]");
  const uploadFile = $("[data-upload-file]");
  const fileName = $("[data-file-name]");
  const removeLogoButton = $("[data-remove-logo]");
  const priceEl = $("[data-price]");
  const priceNote = $("[data-price-note]");
  const addToCartButton = $("[data-add-to-cart]");
  const personalizeButtons = $$("[data-personalize]");
  const newsletterForms = $$("[data-newsletter]");
  const toastRegion = $("[data-toast-region]");

  let lastFocusedElement = null;

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

  function renderCart() {
    const count = state.items.reduce((sum, item) => sum + item.qty, 0);
    const { subtotal, shipping, total } = totals();

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
        return `
          <article class="cart-item" data-id="${escapeHTML(item.id)}">
            <div class="cart-thumb" style="color:${color}" aria-hidden="true">
              <svg viewBox="0 0 400 480"><use href="#hoodie"></use></svg>
            </div>
            <div class="cart-info">
              <div class="cart-item-top">
                <h3>${escapeHTML(item.name || "Sudadera personalizada")}</h3>
                <button type="button" class="remove" data-remove-item="${escapeHTML(item.id)}" aria-label="Quitar ${escapeHTML(item.name || "sudadera")} de la cesta">×</button>
              </div>
              <p class="cart-meta">${escapeHTML(item.colorName || "Negro")} · Talla ${escapeHTML(item.size || "M")}</p>
              ${item.text ? `<p class="cart-custom">“${escapeHTML(item.text)}”</p>` : ""}
              ${item.logoName ? `<p class="cart-custom">Logo: ${escapeHTML(item.logoName)}</p>` : ""}
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
    checkoutTotal.textContent = formatPrice(totals().total);
    checkoutModal.classList.add("is-open");
    checkoutModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
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

  if (checkoutForm) {
    checkoutForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!checkoutForm.checkValidity()) {
        checkoutForm.reportValidity();
        return;
      }

      orderNumber.textContent =
        "CH-" + Math.floor(10000 + Math.random() * 90000);
      checkoutFormView.hidden = true;
      checkoutSuccess.hidden = false;
      checkoutSuccess.scrollIntoView({ block: "nearest" });

      state.items = [];
      saveCart();
      renderCart();

      const focusTarget = $("button", checkoutSuccess);
      if (focusTarget) window.setTimeout(() => focusTarget.focus(), 120);

      showToast("Pedido de demostración confirmado. ¡Gracias!");
    });
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
    textColorButtons.forEach((button) => {
      const active =
        button.dataset.textColor.toLowerCase() === state.textColor.toLowerCase();
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function priceNoteText() {
    const parts = [`Base ${formatPrice(state.basePrice)}`];
    if (state.logo) parts.push(`logo +${formatPrice(LOGO_PRICE)}`);
    if (state.size === "XXL") parts.push(`XXL +${formatPrice(XXL_PRICE)}`);
    parts.push("IVA incluido");
    return parts.join(" · ");
  }

  function updatePreview() {
    if (hoodiePreview) hoodiePreview.style.color = state.color;

    previewNames.forEach((element) => {
      element.textContent = state.colorName;
    });

    if (previewSwatch) previewSwatch.style.background = state.color;
    if (previewSize) previewSize.textContent = state.size;

    if (printText) {
      printText.textContent = state.text;
      printText.hidden = state.text.length === 0;
      printText.style.color = state.textColor;
    }

    if (printLogo) {
      if (state.logo) {
        printLogo.src = state.logo;
        printLogo.alt = "Logo personalizado";
        printLogo.hidden = false;
      } else {
        printLogo.removeAttribute("src");
        printLogo.alt = "";
        printLogo.hidden = true;
      }
    }

    if (printArea) {
      printArea.classList.toggle("has-logo", Boolean(state.logo));
    }

    const total =
      state.basePrice +
      (state.logo ? LOGO_PRICE : 0) +
      (state.size === "XXL" ? XXL_PRICE : 0);

    if (priceEl) priceEl.textContent = formatPrice(total);
    if (priceNote) priceNote.textContent = priceNoteText();

    updateTextColorUI();
  }

  function selectColor(hex, name) {
    state.color = hex;
    state.colorName = name;
    state.basePrice = BASE_PRICES[hex] || state.basePrice;
    state.textColor = contrastFor(hex);

    colorSwatches.forEach((button) => {
      const active = button.dataset.color.toLowerCase() === hex.toLowerCase();
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    updatePreview();
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

  if (textInput) {
    textInput.addEventListener("input", () => {
      state.text = textInput.value.toUpperCase();
      if (charCount) charCount.textContent = String(state.text.length);
      updatePreview();
    });
  }

  textColorButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.textColor = button.dataset.textColor;
      updateTextColorUI();
      updatePreview();
    });
  });

  if (logoInput) {
    logoInput.addEventListener("change", () => {
      const file = logoInput.files && logoInput.files[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        showToast("Formato no válido. Usa PNG, JPG o SVG.");
        logoInput.value = "";
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        showToast("El logo no puede superar los 2 MB.");
        logoInput.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        state.logo = String(reader.result);
        state.logoName = file.name;
        if (uploadFile) uploadFile.hidden = false;
        if (fileName) fileName.textContent = file.name;
        updatePreview();
        showToast("Logo cargado. Quedará genial.");
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
      state.logo = null;
      state.logoName = "";
      if (logoInput) logoInput.value = "";
      if (uploadFile) uploadFile.hidden = true;
      updatePreview();
    });
  }

  if (addToCartButton) {
    addToCartButton.addEventListener("click", () => {
      const unitPrice =
        state.basePrice +
        (state.logo ? LOGO_PRICE : 0) +
        (state.size === "XXL" ? XXL_PRICE : 0);

      const key = [
        state.color,
        state.size,
        state.text,
        state.textColor,
        state.logoName,
        state.basePrice,
      ].join("|");

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
          text: state.text,
          textColor: state.textColor,
          logoName: state.logoName,
          unitPrice,
          qty: 1,
        });
      }

      saveCart();
      renderCart();
      openCart();

      if (cartCount) {
        cartCount.classList.remove("is-pulsing");
        void cartCount.offsetWidth;
        cartCount.classList.add("is-pulsing");
      }
    });
  }

  personalizeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectColor(button.dataset.color, button.dataset.name);
      const section = $("#personalizar");
      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
      showToast(`${button.dataset.name}: lista para personalizar.`);
    });
  });

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
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      form.reset();
      showToast("¡Dentro! Revisa tu email para el 10 % de bienvenida.");
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

  if (charCount) charCount.textContent = String(state.text.length);
  selectColor(state.color, state.colorName);
  renderCart();
})();
