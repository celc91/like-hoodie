#!/usr/bin/env node
/**
 * Genera las páginas de producto de la colección a partir de modelos.json.
 *
 * Uso: node scripts/build-model-pages.mjs
 *
 * Las páginas son estáticas y se publican tal cual. Si cambias precios,
 * descripciones o medidas, edita modelos/modelos.json y vuelve a ejecutar.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const models = JSON.parse(readFileSync(join(root, "modelos", "modelos.json"), "utf8"));
const SITE = "https://likehoodie.com";
const CSS_VERSION = "20261114-fase4c";

const escapeHTML = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const money = (value) => `$${Number(value).toLocaleString("es-MX")}`;

const metaDescription = (text) => {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= 155) return clean;
  const cut = clean.slice(0, 152);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
};

const colorAdjective = (color) => (color === "Blanco" ? "blanca" : "negra");

function page(model) {
  const url = `${SITE}/modelos/${model.id}.html`;
  const image = `${SITE}/assets/modelos/${model.mockup}`;
  const ogImage = `${SITE}/og-cover.jpg`;
  const priceLabel = money(model.price);
  const faq = model.faq || [];
  const description = model.meta || metaDescription(model.description);

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `Sudadera ${model.name}`,
    image: [image],
    description: model.description,
    sku: model.sku,
    brand: { "@type": "Brand", name: "like hoodie" },
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "MXN",
      price: String(model.price),
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: "like hoodie" },
    },
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Modelos", item: `${SITE}/#modelos` },
      { "@type": "ListItem", position: 3, name: model.name, item: url },
    ],
  };

  const faqSchema = faq.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      }
    : null;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHTML(model.name)} — Sudadera personalizada | like hoodie</title>
  <meta name="description" content="${escapeHTML(description)}">
  <meta name="theme-color" content="#f4efe6">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="like hoodie">
  <meta property="og:locale" content="es_MX">
  <meta property="og:title" content="${escapeHTML(model.name)} — like hoodie">
  <meta property="og:description" content="${escapeHTML(model.description.slice(0, 155))}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="like hoodie — sudaderas personalizadas">
  <meta property="product:price:amount" content="${model.price}">
  <meta property="product:price:currency" content="MXN">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHTML(model.name)} — like hoodie">
  <meta name="twitter:description" content="${escapeHTML(model.description.slice(0, 155))}">
  <meta name="twitter:image" content="${ogImage}">
  <meta name="twitter:image:alt" content="like hoodie — sudaderas personalizadas">
  <link rel="icon" href="../favicon.svg" type="image/svg+xml">
  <link rel="icon" type="image/png" sizes="48x48" href="../favicon-48.png">
  <link rel="preload" as="image" href="../assets/modelos/${model.mockup}" type="image/webp" fetchpriority="high">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../styles.css?v=${CSS_VERSION}">
  <link rel="stylesheet" href="producto.css?v=${CSS_VERSION}">
  <script type="application/ld+json">${JSON.stringify(productSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  ${faqSchema ? `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>` : ""}
</head>
<body class="product-page" data-wa-context="${escapeHTML(model.name)}">
  <a class="skip-link" href="#contenido">Saltar al contenido</a>

  <header class="product-header">
    <div class="container product-header__inner">
      <a class="brand" href="../" aria-label="like hoodie ♡, volver al inicio">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64"><path d="M32 50S14 39 14 27a9 9 0 0 1 18-4 9 9 0 0 1 18 4c0 12-18 23-18 23Z" fill="currentColor"/></svg>
        </span>
        <span class="brand-name">like hoodie ♡</span>
      </a>
      <a class="product-back" href="../#modelos">← Volver a la colección</a>
    </div>
  </header>

  <main id="contenido">
    <nav class="product-breadcrumb container" aria-label="Miga de pan">
      <a href="../">Inicio</a>
      <span aria-hidden="true">/</span>
      <a href="../#modelos">Modelos</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${escapeHTML(model.short)}</span>
    </nav>

    <section class="product-hero container" data-product="${model.id}">
      <div class="product-visual">
        <img src="../assets/modelos/${model.mockup}" alt="Sudadera ${colorAdjective(model.color)} con ${escapeHTML(model.name)}" width="${model.width || 900}" height="${model.height || 1103}" fetchpriority="high">
      </div>
      <div class="product-info">
        <span class="eyebrow">${model.badge ? `${escapeHTML(model.badge)} · ` : ""}DTG full color</span>
        <h1>${escapeHTML(model.name)}</h1>
        <p class="product-price">
          <strong data-product-price>${priceLabel}</strong> <span>MXN</span>
          <small>IVA incluido</small>
        </p>
        <p class="product-lead">${escapeHTML(model.description)}</p>

        <div class="product-buy">
          <label for="product-size">Talla</label>
          <select id="product-size" data-product-size aria-label="Talla de ${escapeHTML(model.name)}">
            <option value="XS">XS</option>
            <option value="S">S</option>
            <option value="M" selected>M</option>
            <option value="L">L</option>
            <option value="XL">XL</option>
            <option value="XXL">XXL (+$49)</option>
          </select>
          <a class="btn btn-primary btn-block" data-buy-link href="../?comprar=${model.id}&amp;talla=M#modelos">Comprar talla M</a>
          <p class="product-note">Preparamos el archivo de impresión al momento. La compra se completa en la tienda.</p>
        </div>

        <ul class="product-bullets">
          ${model.details.map((detail) => `<li>${escapeHTML(detail)}</li>`).join("")}
        </ul>
      </div>
    </section>

    <section class="product-details container" aria-label="Detalles del producto">
      <article>
        <span>01</span>
        <h2>Algodón 400 g</h2>
        <p>Felpa gruesa, abrigadora y con caída premium. La base que aguanta el uso diario.</p>
      </article>
      <article>
        <span>02</span>
        <h2>DTG full color</h2>
        <p>Impresión directa al tejido, sin vinilo rígido. Colores vivos y tacto suave desde el primer lavado.</p>
      </article>
      <article>
        <span>03</span>
        <h2>Sin mínimos</h2>
        <p>Una sudadera también es un pedido. Producimos en 24–48 h y enviamos en 48–72 h.</p>
      </article>
    </section>

    <section class="product-faq container" aria-labelledby="product-faq-title">
      <h2 id="product-faq-title">Preguntas sobre este modelo</h2>
      ${faq
        .map(
          (item) => `<details>
        <summary>${escapeHTML(item.q)}</summary>
        <p>${escapeHTML(item.a)}</p>
      </details>`
        )
        .join("")}
      <p class="product-faq__more">¿Otra duda? <a href="mailto:hola@likehoodie.com">Escríbenos</a> y te contestamos en menos de 24 h.</p>
    </section>

    <section class="product-cta container">
      <div>
        <span class="eyebrow">La colección</span>
        <h2>Más modelos listos para llevar.</h2>
      </div>
      <a class="btn btn-dark" href="../#modelos">Ver todos los modelos</a>
    </section>
  </main>

  <footer class="product-footer">
    <div class="container">
      <p>© 2026 like hoodie ♡. Hecho con algodón y buenas ideas.</p>
      <nav aria-label="Enlaces del pie">
        <a href="../terminos.html">Términos</a>
        <a href="../privacidad.html">Privacidad</a>
        <a href="../cookies.html">Cookies</a>
        <a href="https://wa.me/525552142692" data-whatsapp-link target="_blank" rel="noopener noreferrer">WhatsApp</a>
      </nav>
    </div>
  </footer>

  <script>
    (function () {
      var basePrice = ${model.price};
      var select = document.querySelector("[data-product-size]");
      var price = document.querySelector("[data-product-price]");
      var link = document.querySelector("[data-buy-link]");
      if (!select || !price || !link) return;
      function sync() {
        var total = basePrice + (select.value === "XXL" ? 49 : 0);
        price.textContent = "$" + total.toLocaleString("es-MX");
        link.href = "../?comprar=${model.id}&talla=" + encodeURIComponent(select.value) + "#modelos";
        link.textContent = "Comprar talla " + select.value;
      }
      select.addEventListener("change", sync);
      sync();
    })();
  </script>
  <script src="../whatsapp-config.js?v=${CSS_VERSION}"></script>
  <script src="../whatsapp.js?v=${CSS_VERSION}"></script>
</body>
</html>
`;
}

for (const model of models) {
  const file = join(root, "modelos", `${model.id}.html`);
  writeFileSync(file, page(model), "utf8");
  console.log(`modelos/${model.id}.html`);
}
