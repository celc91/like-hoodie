// like hoodie ♡ — reseñas reales de clientes.
// Lee resenas.json y solo pinta las que tienen consentimiento explícito.
// Si la lista está vacía, la sección queda oculta: no hay reseñas inventadas.

(() => {
  const section = document.getElementById("resenas");
  if (!section) return;

  const list = section.querySelector("[data-reviews]");
  const summary = document.getElementById("resenas-summary");
  if (!list || !summary) return;

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));

  const formatDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  };

  fetch("resenas.json", { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : []))
    .then((items) => {
      const reviews = (Array.isArray(items) ? items : []).filter((review) => {
        const rating = Number(review?.rating);
        return (
          review &&
          review.consent === true &&
          typeof review.name === "string" &&
          review.name.trim() !== "" &&
          typeof review.text === "string" &&
          review.text.trim() !== "" &&
          rating >= 1 &&
          rating <= 5
        );
      });

      if (reviews.length === 0) return;

      list.innerHTML = reviews
        .map((review) => {
          const rating = Math.round(Number(review.rating));
          const date = formatDate(review.date);
          return `<li class="review-card">
            <p class="review-card__stars" aria-hidden="true">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</p>
            <p class="review-card__text">“${escapeHtml(review.text)}”</p>
            <p class="review-card__meta">
              <strong>${escapeHtml(review.name)}</strong>
              ${review.product ? ` · ${escapeHtml(review.product)}` : ""}
              ${date ? ` · ${escapeHtml(date)}` : ""}
              <span class="sr-only">${rating} de 5 estrellas.</span>
            </p>
          </li>`;
        })
        .join("");

      const average =
        reviews.reduce((sum, review) => sum + Number(review.rating), 0) / reviews.length;
      summary.textContent = `${reviews.length} ${reviews.length === 1 ? "reseña" : "reseñas"} · ${average.toFixed(1)} de 5`;
      section.hidden = false;
    })
    .catch(() => {
      // Sin datos o sin red la sección permanece oculta.
    });
})();
