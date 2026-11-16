(function () {
  var select = document.querySelector("[data-product-size]");
  var price = document.querySelector("[data-product-price]");
  var link = document.querySelector("[data-buy-link]");
  if (!select || !price || !link) return;

  var basePrice = Number(link.dataset.basePrice) || 0;
  var model = link.dataset.model || "";
  var sku = link.dataset.sku || model;
  var name = link.dataset.name || document.title;

  function currentPrice() {
    return basePrice + (select.value === "XXL" ? 49 : 0);
  }

  function sync() {
    var total = currentPrice();
    price.textContent = "$" + total.toLocaleString("es-MX");
    link.href =
      "../?comprar=" +
      encodeURIComponent(model) +
      "&talla=" +
      encodeURIComponent(select.value) +
      "#modelos";
    link.textContent = "Comprar talla " + select.value;
  }

  /* Vista de producto: una sola vez por carga, y solo con permiso.
     Se envía a GA4 como view_item y a Meta como ViewContent. */
  var viewed = false;
  function viewItem() {
    if (viewed) return;
    var consent = window.LikeHoodieConsent;
    if (!consent || typeof consent.track !== "function" || !consent.get()) return;

    var total = currentPrice();
    var item = {
      item_id: sku,
      item_name: name,
      item_variant: select.value,
      price: total,
      quantity: 1,
    };
    viewed = true;
    consent.track("view_item", {
      currency: "MXN",
      value: total,
      content_type: "product",
      content_ids: [sku],
      contents: [{ id: sku, quantity: 1, item_price: total }],
      items: [item],
    });
  }

  select.addEventListener("change", sync);
  sync();

  document.addEventListener("likehoodie:consent", viewItem);
  viewItem();
})();
