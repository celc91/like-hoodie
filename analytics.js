/* ==========================================================================
   like hoodie ♡ — consentimiento y etiquetas (GA4 + Meta Pixel)
   --------------------------------------------------------------------------
   Dos permisos independientes:
     · analytics → Google Analytics 4
     · ads       → Meta Pixel (publicidad)
   Nada se carga hasta que la persona lo acepta.
   ========================================================================== */

(function () {
  "use strict";

  const KEY = "likehoodie_consent_v2";
  const GA_ID = String(window.LIKEHOODIE_GA_ID || "").trim();
  const PIXEL_ID = String(window.LIKEHOODIE_META_PIXEL || "").trim();

  const GA_OK = GA_ID.indexOf("G-") === 0;
  const PIXEL_OK = /^\d{8,20}$/.test(PIXEL_ID);

  function read() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      // compatibilidad con la versión anterior (solo texto)
      if (raw === "granted") return { analytics: true, ads: false };
      if (raw === "denied") return { analytics: false, ads: false };
      const parsed = JSON.parse(raw);
      return { analytics: Boolean(parsed.analytics), ads: Boolean(parsed.ads) };
    } catch (error) {
      return null;
    }
  }

  function write(state) {
    try {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ analytics: Boolean(state.analytics), ads: Boolean(state.ads) })
      );
    } catch (error) {
      /* sin almacenamiento: la elección dura solo esta visita */
    }
  }

  function dropCookies(prefixes) {
    const names = document.cookie.split(";").map(function (item) {
      return item.split("=")[0].trim();
    });
    names.forEach(function (name) {
      if (!prefixes.some(function (p) { return name.indexOf(p) === 0; })) return;
      document.cookie = name + "=; Max-Age=0; path=/";
      document.cookie =
        name + "=; Max-Age=0; path=/; domain=." + location.hostname.replace(/^www\./, "");
    });
  }

  /* ------------------------------ Google Analytics ---------------------- */

  function loadGA() {
    if (!GA_OK || document.getElementById("ga4-script")) return;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };

    window.gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted",
    });
    window.gtag("js", new Date());

    const script = document.createElement("script");
    script.id = "ga4-script";
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(script);

    window.gtag("config", GA_ID, { anonymize_ip: true });
  }

  function revokeGA() {
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", { analytics_storage: "denied" });
    }
    dropCookies(["_ga", "_gid"]);
  }

  /* ------------------------------ Meta Pixel ---------------------------- */

  function loadMeta() {
    if (!PIXEL_OK || window.fbq) return;

    /* eslint-disable */
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */

    window.fbq("init", PIXEL_ID);
    window.fbq("track", "PageView");
  }

  function revokeMeta() {
    if (typeof window.fbq === "function") {
      window.fbq("consent", "revoke");
    }
    dropCookies(["_fbp", "_fbc"]);
  }

  /* ------------------------------ API ----------------------------------- */

  function apply(state) {
    if (state.analytics) loadGA();
    else revokeGA();
    if (state.ads) loadMeta();
    else revokeMeta();
  }

  function set(next) {
    const state = { analytics: Boolean(next && next.analytics), ads: Boolean(next && next.ads) };
    write(state);
    apply(state);
    document.dispatchEvent(new CustomEvent("likehoodie:consent", { detail: state }));
    return state;
  }

  const GA_EVENTS = {
    add_to_cart: "add_to_cart",
    begin_checkout: "begin_checkout",
    order_created: "purchase",
    newsletter_signup: "sign_up",
    coupon_applied: "select_promotion",
  };

  const META_EVENTS = {
    add_to_cart: "AddToCart",
    begin_checkout: "InitiateCheckout",
    order_created: "Purchase",
    newsletter_signup: "Lead",
    coupon_applied: "AddToCart",
  };

  // Envía un evento a las plataformas que la persona haya aceptado
  function track(name, params) {
    const state = read();
    if (!state) return;
    if (state.analytics && typeof window.gtag === "function" && GA_EVENTS[name]) {
      window.gtag("event", GA_EVENTS[name], params || {});
    }
    if (state.ads && typeof window.fbq === "function" && META_EVENTS[name]) {
      window.fbq("track", META_EVENTS[name], params || {});
    }
  }

  const stored = read();
  if (stored) apply(stored);

  window.LikeHoodieConsent = {
    gaId: GA_ID,
    pixelId: PIXEL_ID,
    available: { analytics: GA_OK, ads: PIXEL_OK },
    get: read,
    set: set,
    track: track,
    open: function () {
      document.dispatchEvent(new CustomEvent("likehoodie:consent-open"));
    },
  };
})();
