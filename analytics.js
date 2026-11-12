/* ==========================================================================
   like hoodie ♡ — consentimiento de analítica (GA4)
   --------------------------------------------------------------------------
   Nada de Google se carga hasta que la persona acepta. Si rechaza, no se
   descarga ni un byte de googletagmanager.com ni se crea ninguna cookie.
   ========================================================================== */

(function () {
  "use strict";

  const KEY = "likehoodie_consent_v2";
  const GA_ID = String(window.LIKEHOODIE_GA_ID || "").trim();
  const VALID = GA_ID.indexOf("G-") === 0;

  function read() {
    try {
      const value = window.localStorage.getItem(KEY);
      return value === "granted" || value === "denied" ? value : null;
    } catch (error) {
      return null;
    }
  }

  function write(value) {
    try {
      window.localStorage.setItem(KEY, value);
    } catch (error) {
      /* sin almacenamiento: la elección dura solo esta visita */
    }
  }

  function dropCookies() {
    const names = document.cookie.split(";").map(function (item) {
      return item.split("=")[0].trim();
    });
    names.forEach(function (name) {
      if (name.indexOf("_ga") !== 0 && name.indexOf("_gid") !== 0) return;
      document.cookie = name + "=; Max-Age=0; path=/";
      document.cookie = name + "=; Max-Age=0; path=/; domain=." + location.hostname.replace(/^www\./, "");
    });
  }

  function loadGA() {
    if (!VALID || document.getElementById("ga4-script")) return;

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
    dropCookies();
  }

  function apply(choice) {
    if (choice === "granted") loadGA();
    else if (choice === "denied") revokeGA();
  }

  function set(choice, options) {
    const value = choice === "granted" ? "granted" : "denied";
    write(value);
    apply(value);
    if (!options || options.silent !== true) {
      document.dispatchEvent(new CustomEvent("likehoodie:consent", { detail: value }));
    }
    return value;
  }

  // Si ya había una decisión guardada, se aplica al cargar.
  const stored = read();
  if (stored) apply(stored);

  window.LikeHoodieConsent = {
    id: GA_ID,
    enabled: VALID,
    get: read,
    set: set,
    // permite reabrir el aviso desde "Cookies" o desde cualquier enlace
    open: function () {
      document.dispatchEvent(new CustomEvent("likehoodie:consent-open"));
    },
  };
})();
