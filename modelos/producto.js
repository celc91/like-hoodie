(function () {
  var select = document.querySelector("[data-product-size]");
  var price = document.querySelector("[data-product-price]");
  var link = document.querySelector("[data-buy-link]");
  if (!select || !price || !link) return;

  var basePrice = Number(link.dataset.basePrice) || 0;
  var model = link.dataset.model || "";

  function sync() {
    var total = basePrice + (select.value === "XXL" ? 49 : 0);
    price.textContent = "$" + total.toLocaleString("es-MX");
    link.href =
      "../?comprar=" +
      encodeURIComponent(model) +
      "&talla=" +
      encodeURIComponent(select.value) +
      "#modelos";
    link.textContent = "Comprar talla " + select.value;
  }

  select.addEventListener("change", sync);
  sync();
})();
