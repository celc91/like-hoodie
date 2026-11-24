// like hoodie ♡ — cambio de idioma ES/EN en el navegador.
// El diccionario vive en i18n-store.js o i18n-admin.js dentro de window.LH_I18N.
// Traduce nodos de texto y atributos visibles, y recuerda el idioma elegido.
(() => {
  const STORAGE_KEY = "lh-lang";
  const SUPPORTED = ["es", "en"];
  const ATTRS = ["placeholder", "aria-label", "title", "alt", "value"];
  const SKIP = "script, style, svg, code, pre, [data-no-i18n], .monaco-editor";

  const dictionary = (window.LH_I18N && window.LH_I18N.en) || {};
  const customPatterns = (window.LH_I18N && window.LH_I18N.patterns) || [];

  const MONTHS = {
    ene: "Jan", feb: "Feb", mar: "Mar", abr: "Apr", may: "May", jun: "Jun",
    jul: "Jul", ago: "Aug", sep: "Sep", set: "Sep", oct: "Oct", nov: "Nov", dic: "Dec",
  };

  const COLORS = {
    negro: "Black", blanco: "White", blanca: "White", crema: "Cream", lima: "Lime",
    terracota: "Terracotta", naranja: "Orange", azul: "Blue", gris: "Gray",
    "off-white": "Off-White", verde: "Green", rojo: "Red", rosa: "Pink",
  };

  function translateColor(value) {
    return COLORS[String(value).trim().toLocaleLowerCase("es-MX")] || value;
  }

  function translateShortDate(value) {
    const match = String(value).trim().match(/^(\d{1,2})\s+([a-záéíóú]+)\.?$/i);
    if (!match) return value;
    const month = MONTHS[match[2].toLocaleLowerCase("es-MX").slice(0, 3)];
    return month ? `${month} ${match[1]}` : value;
  }

  const patterns = [
    ...customPatterns,
    {
      re: /^Llega antes del (.+) · producción 24–48 h \+ envío 48–72 h$/,
      en: (m) => `Arrives before ${translateShortDate(m[1])} · made in 24–48 h + shipping 48–72 h`,
    },
    {
      re: /^Llega antes del (.+)$/,
      en: (m) => `Arrives before ${translateShortDate(m[1])}`,
    },
    {
      re: /^Te faltan (.+) para el envío gratis\.?$/,
      en: (m) => `You're ${m[1]} away from free shipping.`,
    },
    {
      re: /^Envío gratis desde (.+)$/,
      en: (m) => `Free shipping from ${m[1]}`,
    },
    {
      re: /^Abrir la cesta, (\d+) artículos?$/,
      en: (m) => `Open bag, ${m[1]} ${m[1] === "1" ? "item" : "items"}`,
    },
    {
      re: /^(\d+) artículos?$/,
      en: (m) => `${m[1]} ${m[1] === "1" ? "item" : "items"}`,
    },
    {
      re: /^(\d+) piezas?$/,
      en: (m) => `${m[1]} ${m[1] === "1" ? "piece" : "pieces"}`,
    },
    {
      re: /^Talla (.+)$/,
      en: (m) => `Size ${m[1]}`,
    },
    {
      re: /^(.+) · Talla (.+)$/,
      en: (m) => `${translateColor(m[1])} · Size ${m[2]}`,
    },
    {
      re: /^Frente: (.+)$/,
      en: (m) => `Front: ${m[1]}`,
    },
    {
      re: /^Espalda: (.+)$/,
      en: (m) => `Back: ${m[1]}`,
    },
    {
      re: /^Pedido (.+)$/,
      en: (m) => `Order ${m[1]}`,
    },
    {
      re: /^(.+) añadido a la cesta\.$/,
      en: (m) => `${m[1]} added to your bag.`,
    },
    {
      re: /^(.+) añadidas a la cesta\.$/,
      en: (m) => `${m[1]} added to your bag.`,
    },
    {
      re: /^Actualizado (.+)$/,
      en: (m) => `Updated ${m[1]}`,
    },
    {
      re: /^(\d+) abiertas$/,
      en: (m) => `${m[1]} open`,
    },
    {
      re: /^(\d+) % de cierre$/,
      en: (m) => `${m[1]} % close rate`,
    },
    {
      re: /^Ticket medio (.+)$/,
      en: (m) => `Average ticket ${m[1]}`,
    },
    {
      re: /^(\d+) conversaciones · (.+)$/,
      en: (m) => `${m[1]} conversations · ${m[2]}`,
    },
  ];
  const exact = new Map();
  const lower = new Map();

  Object.keys(dictionary).forEach((key) => {
    const value = dictionary[key];
    if (typeof value !== "string" || !value) return;
    exact.set(key, value);
    const normalized = key.toLocaleLowerCase("es-MX");
    if (!lower.has(normalized)) lower.set(normalized, value);
  });

  const textOriginals = new WeakMap();
  const attrOriginals = new WeakMap();
  const recentlySet = new WeakMap();

  let lang = "es";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.includes(stored)) lang = stored;
  } catch (_) {
    /* almacenamiento no disponible */
  }

  const leading = (text) => (text.match(/^\s*/) || [""])[0];
  const trailing = (text) => (text.match(/\s*$/) || [""])[0];

  function translateString(value) {
    if (lang !== "en" || typeof value !== "string") return value;
    const source = value.trim();
    if (!source) return value;

    const direct = exact.get(source);
    if (direct) return leading(value) + direct + trailing(value);

    const insensitive = lower.get(source.toLocaleLowerCase("es-MX"));
    if (insensitive) return leading(value) + insensitive + trailing(value);

    for (const pattern of patterns) {
      try {
        const match = source.match(pattern.re);
        if (match) {
          const result = pattern.en(match);
          if (typeof result === "string" && result) {
            return leading(value) + result + trailing(value);
          }
        }
      } catch (_) {
        /* una expresión regular inválida no debe romper la página */
      }
    }
    return value;
  }

  function translatable(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    if (parent.closest(SKIP)) return false;
    if (parent.isContentEditable) return false;
    return true;
  }

  function applyTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (!node.nodeValue || !node.nodeValue.trim()) return;
    if (!translatable(node)) return;

    if (!textOriginals.has(node)) textOriginals.set(node, node.nodeValue);
    const source = textOriginals.get(node);
    const next = lang === "en" ? translateString(source) : source;
    if (next !== node.nodeValue) {
      recentlySet.set(node, next);
      node.nodeValue = next;
    }
  }

  function applyAttributes(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    if (element.closest(SKIP)) return;

    ATTRS.forEach((name) => {
      if (!element.hasAttribute(name)) return;
      const current = element.getAttribute(name);
      if (current == null || !current.trim()) return;
      if (name === "value" && !/^(button|submit|reset)$/i.test(element.type || "")) return;

      let originals = attrOriginals.get(element);
      if (!originals) {
        originals = new Map();
        attrOriginals.set(element, originals);
      }
      if (!originals.has(name)) originals.set(name, current);
      const source = originals.get(name);
      const next = lang === "en" ? translateString(source) : source;
      if (next !== current) {
        recentlySet.set(element, name + "=" + next);
        element.setAttribute(name, next);
      }
    });
  }

  function applyTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      applyTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

    if (root.nodeType === Node.ELEMENT_NODE) applyAttributes(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) applyTextNode(node);
      else if (node.nodeType === Node.ELEMENT_NODE) applyAttributes(node);
      node = walker.nextNode();
    }
  }

  function applyTitle() {
    const title = document.querySelector("title");
    if (title) applyTree(title);
    document.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]').forEach((meta) => {
      const content = meta.getAttribute("content");
      if (!content) return;
      const next = lang === "en" ? translateString(content) : content;
      if (next !== content) meta.setAttribute("content", next);
    });
  }

  function refreshSwitcher() {
    document.querySelectorAll("[data-lang]").forEach((button) => {
      const active = button.getAttribute("data-lang") === lang;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function setLang(next, options = {}) {
    const normalized = SUPPORTED.includes(next) ? next : "es";
    if (normalized === lang && !options.force) {
      refreshSwitcher();
      return;
    }
    lang = normalized;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {
      /* almacenamiento no disponible */
    }
    document.documentElement.lang = lang === "en" ? "en" : "es";
    applyTree(document.body);
    applyTitle();
    refreshSwitcher();
    document.dispatchEvent(new CustomEvent("lh:langchange", { detail: { lang } }));
  }

  function buildSwitcher(container) {
    const group = document.createElement("div");
    group.className = "lang-switch";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Idioma / Language");

    ["es", "en"].forEach((code) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.lang = code;
      button.textContent = code.toUpperCase();
      button.setAttribute("aria-label", code === "es" ? "Español" : "English");
      button.addEventListener("click", () => setLang(code));
      group.appendChild(button);
    });
    container.appendChild(group);
    return group;
  }

  function ensureSwitcher() {
    const hosts = [];
    const headerActions = document.querySelector(".header-actions");
    const loginCard = document.querySelector(".login-card");
    const topbarActions = document.querySelector(".topbar-actions");
    if (headerActions) hosts.push(headerActions);
    if (loginCard) hosts.push(loginCard);
    if (topbarActions) hosts.push(topbarActions);

    if (!hosts.length) {
      const fallback =
        document.querySelector(".site-header .container") ||
        document.querySelector("header .container") ||
        document.querySelector("header");
      if (fallback) hosts.push(fallback);
    }

    hosts.forEach((host) => {
      if (!host.querySelector(":scope > .lang-switch")) buildSwitcher(host);
    });

    if (!hosts.length) {
      const floating = buildSwitcher(document.body);
      floating.classList.add("lang-switch--floating");
    }
    refreshSwitcher();
  }

  function observe() {
    if (!document.body || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((records) => {
      if (lang !== "en") return;
      records.forEach((record) => {
        if (record.type === "characterData") {
          const node = record.target;
          if (!node || node.nodeType !== Node.TEXT_NODE) return;
          if (recentlySet.get(node) === node.nodeValue) {
            recentlySet.delete(node);
            return;
          }
          if (!translatable(node)) return;
          textOriginals.set(node, node.nodeValue);
          applyTextNode(node);
          return;
        }

        if (record.type === "attributes") {
          const element = record.target;
          const name = record.attributeName;
          if (!element || !name || !ATTRS.includes(name)) return;
          if (recentlySet.get(element) === name + "=" + element.getAttribute(name)) {
            recentlySet.delete(element);
            return;
          }
          const originals = attrOriginals.get(element);
          if (originals) originals.delete(name);
          applyAttributes(element);
          return;
        }

        record.addedNodes.forEach((node) => applyTree(node));
      });
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  function start() {
    document.documentElement.lang = lang === "en" ? "en" : "es";
    ensureSwitcher();
    if (lang === "en") {
      applyTree(document.body);
      applyTitle();
    }
    observe();
    refreshSwitcher();
  }

  // Los avisos nativos también respetan el idioma.
  ["alert", "confirm"].forEach((name) => {
    const native = window[name];
    if (typeof native !== "function") return;
    window[name] = function (message) {
      try {
        return native.call(window, lang === "en" ? translateString(String(message)) : message);
      } catch (_) {
        return native.call(window, message);
      }
    };
  });

  window.LH_i18n = { t: translateString, setLang, getLang: () => lang, apply: applyTree, translate: translateString };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
