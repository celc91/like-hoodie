// like hoodie ♡ — calendario de conciertos
// Datos: Ticketmaster México (https://www.ticketmaster.com.mx/section/conciertos)
(() => {
  const root = document.querySelector("[data-events-app]");
  if (!root) return;

  const grid = root.querySelector("[data-cal-grid]");
  const monthTitle = root.querySelector("[data-cal-title]");
  const prevButton = root.querySelector("[data-cal-prev]");
  const nextButton = root.querySelector("[data-cal-next]");
  const list = root.querySelector("[data-events-list]");
  const dateLabel = root.querySelector("[data-events-title]");
  const kicker = root.querySelector("[data-events-kicker]");
  const cityFilter = root.querySelector("[data-city-filter]");
  const updatedLabel = root.querySelector("[data-events-updated]");

  if (!grid || !list || !monthTitle) return;

  const TM_URL = "https://www.ticketmaster.com.mx/section/conciertos";
  const MONTHS = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const MONTHS_SHORT = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  const WEEKDAYS = [
    "domingo",
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
  ];

  const state = {
    events: [],
    filtered: [],
    month: new Date(),
    selected: "",
    city: "all",
    minMonth: "",
    maxMonth: "",
    expanded: false,
  };

  const pad = (value) => String(value).padStart(2, "0");

  const startDate = (value) => {
    const [datePart, timePart = "00:00"] = String(value).split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    return new Date(year, month - 1, day, hour || 0, minute || 0);
  };

  const dateKey = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const monthKey = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

  const keyToDate = (key) => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const escapeHTML = (value) =>
    String(value).replace(/[&<>"']/g, (character) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return map[character];
    });

  const safeExternalUrl = (value) => {
    try {
      const url = new URL(String(value));
      return url.protocol === "https:" ? url.href : "";
    } catch (error) {
      return "";
    }
  };

  const capitalize = (value) =>
    value.charAt(0).toUpperCase() + value.slice(1);

  const formatTime = (value) => {
    const date = startDate(value);
    let hour = date.getHours();
    const period = hour >= 12 ? "p.m." : "a.m.";
    hour = hour % 12 || 12;
    return `${hour}:${pad(date.getMinutes())} ${period}`;
  };

  const longDate = (key) => {
    const date = keyToDate(key);
    return capitalize(
      `${WEEKDAYS[date.getDay()]}, ${date.getDate()} de ${MONTHS[date.getMonth()]}`
    );
  };

  const shortDate = (key) => {
    const date = keyToDate(key);
    return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  };

  const suggestionFor = (event) => {
    const date = keyToDate(event.dateKey);
    const month = MONTHS_SHORT[date.getMonth()].toUpperCase();
    const base = String(event.name)
      .split(/\s+[-–—]\s+|[,:–—]/)[0]
      .replace(/\b(tour|live|concierto|festival|presenta|presentan)\b/gi, " ")
      .replace(/[\s\-–—]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
    const words = base.split(" ").filter(Boolean);
    let name = "";

    for (const word of words) {
      const next = name ? `${name} ${word}` : word;
      if (next.length > 12 && name) break;
      name = next;
    }

    name = (name || base).slice(0, 16).trim();
    const suffix = ` ${date.getDate()} ${month}`;
    return name.length + suffix.length <= 16 ? `${name}${suffix}` : name;
  };

  const monthLabel = (date) =>
    `${capitalize(MONTHS[date.getMonth()])} ${date.getFullYear()}`;

  const todayKey = dateKey(new Date());

  const eventCard = (event) => {
    const [time, period] = formatTime(event.start).split(" ");
    const designText = suggestionFor(event);
    const ticketUrl = safeExternalUrl(event.url);
    return `
      <article class="event-card">
        <div class="event-time">
          <strong>${time}</strong>
          <span>${period}</span>
        </div>
        <div class="event-main">
          <h4>${escapeHTML(event.name)}</h4>
          <p>${escapeHTML(event.venue)} <span aria-hidden="true">·</span> ${escapeHTML(event.city)}</p>
        </div>
        <div class="event-actions">
          <button
            type="button"
            class="event-design"
            data-design-event="${escapeHTML(designText)}"
            aria-label="Diseñar una sudadera inspirada en ${escapeHTML(event.name)}"
          >
            Diseñar
          </button>
          ${
            ticketUrl
              ? `<a class="event-ticket" href="${escapeHTML(
                  ticketUrl
                )}" target="_blank" rel="noopener noreferrer">
            Boletos
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M7 17 17 7M9 7h8v8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>`
              : ""
          }
        </div>
      </article>
    `;
  };

  const emptyState = () => {
    const next = state.filtered.find((event) => event.dateKey > state.selected);
    const cityText =
      state.city === "all" ? "" : ` en ${escapeHTML(state.city)}`;
    return `
      <div class="events-empty">
        <span class="events-empty-mark" aria-hidden="true">♡</span>
        <p>No hay conciertos este día${cityText}.</p>
        ${
          next
            ? `<button type="button" class="events-empty-link" data-next-event="${next.dateKey}">
                Ver el siguiente: ${escapeHTML(next.name)} · ${shortDate(next.dateKey)}
              </button>`
            : `<a class="events-empty-link" href="${TM_URL}" target="_blank" rel="noopener noreferrer">Ver la cartelera completa en Ticketmaster</a>`
        }
      </div>
    `;
  };

  function renderCalendar() {
    monthTitle.textContent = monthLabel(state.month);

    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const currentMonthKey = monthKey(state.month);

    const counts = new Map();
    state.filtered.forEach((event) => {
      if (event.dateKey.startsWith(currentMonthKey)) {
        counts.set(event.dateKey, (counts.get(event.dateKey) || 0) + 1);
      }
    });

    const previousMonthDays = new Date(year, month, 0).getDate();
    let html = "";

    for (let index = offset - 1; index >= 0; index -= 1) {
      html += `
        <span class="cal-day is-outside" aria-hidden="true">
          <span class="cal-day-number">${previousMonthDays - index}</span>
        </span>
      `;
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${pad(month + 1)}-${pad(day)}`;
      const count = counts.get(key) || 0;
      const classes = ["cal-day"];
      if (count > 0) classes.push("has-events");
      if (key === state.selected) classes.push("is-selected");
      if (key === todayKey) classes.push("is-today");
      if (key < todayKey) classes.push("is-past");

      const label = count
        ? `${day} de ${MONTHS[month]}, ${count} ${count === 1 ? "concierto" : "conciertos"}`
        : `${day} de ${MONTHS[month]}, sin conciertos`;
      const accessibleLabel = `${day}${count ? " " + count : ""}, ${label}`;

      html += `
        <button
          type="button"
          class="${classes.join(" ")}"
          data-cal-day="${key}"
          aria-label="${accessibleLabel}"
          aria-pressed="${key === state.selected ? "true" : "false"}"
        >
          <span class="cal-day-number">${day}</span>
          ${count ? `<span class="cal-day-count">${count}</span>` : ""}
        </button>
      `;
    }

    const trailingDays = (7 - ((offset + daysInMonth) % 7)) % 7;
    for (let day = 1; day <= trailingDays; day += 1) {
      html += `
        <span class="cal-day is-outside" aria-hidden="true">
          <span class="cal-day-number">${day}</span>
        </span>
      `;
    }

    grid.innerHTML = html;

    if (prevButton) {
      prevButton.disabled = !state.minMonth || currentMonthKey <= state.minMonth;
    }
    if (nextButton) {
      nextButton.disabled = !state.maxMonth || currentMonthKey >= state.maxMonth;
    }
  }

  function renderList() {
    const dayEvents = state.filtered.filter(
      (event) => event.dateKey === state.selected
    );

    if (dateLabel) dateLabel.textContent = longDate(state.selected);
    if (kicker) {
      kicker.textContent = dayEvents.length
        ? `${dayEvents.length} ${dayEvents.length === 1 ? "concierto" : "conciertos"}`
        : "Sin conciertos";
    }

    if (!dayEvents.length) {
      list.innerHTML = emptyState();
    } else {
      const visible = state.expanded ? dayEvents : dayEvents.slice(0, 5);
      const remaining = dayEvents.length - visible.length;
      list.innerHTML =
        visible.map(eventCard).join("") +
        (remaining > 0
          ? `<button type="button" class="events-more" data-show-all>
              Ver ${remaining} ${remaining === 1 ? "evento más" : "eventos más"}
            </button>`
          : "");
    }

    if (updatedLabel && state.updated) {
      const updated = startDate(state.updated);
      updatedLabel.textContent = `Actualizado ${shortDate(dateKey(updated))} ${updated.getFullYear()}`;
    }
  }

  function render() {
    renderCalendar();
    renderList();
  }

  function setFilteredEvents() {
    state.filtered =
      state.city === "all"
        ? state.events
        : state.events.filter((event) => event.city === state.city);

    const months = [
      ...new Set(state.filtered.map((event) => event.dateKey.slice(0, 7))),
    ].sort();
    state.minMonth = months[0] || "";
    state.maxMonth = months[months.length - 1] || "";
  }

  function selectNearestEvent() {
    const current = state.filtered.find(
      (event) => event.dateKey === state.selected
    );
    if (current) return;
    const next =
      state.filtered.find((event) => event.dateKey >= state.selected) ||
      state.filtered[0];
    if (next) {
      state.selected = next.dateKey;
      state.month = keyToDate(`${next.dateKey.slice(0, 7)}-01`);
    }
  }

  function fillCities() {
    if (!cityFilter) return;
    const counts = new Map();
    state.events.forEach((event) => {
      counts.set(event.city, (counts.get(event.city) || 0) + 1);
    });

    const cities = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
      .map(([city]) => city);

    cityFilter.innerHTML = [
      '<option value="all">Todas las ciudades</option>',
      ...cities.map(
        (city) =>
          `<option value="${escapeHTML(city)}">${escapeHTML(city)}</option>`
      ),
    ].join("");
    cityFilter.value = state.city;
  }

  function showLoadError() {
    monthTitle.textContent = monthLabel(state.month);
    grid.innerHTML =
      '<p class="events-load-error">No pudimos cargar el calendario.</p>';
    list.innerHTML = `
      <div class="events-empty">
        <span class="events-empty-mark" aria-hidden="true">♡</span>
        <p>La agenda no está disponible en este momento.</p>
        <a class="events-empty-link" href="${TM_URL}" target="_blank" rel="noopener noreferrer">
          Ver conciertos en Ticketmaster
        </a>
      </div>
    `;
    if (kicker) kicker.textContent = "Agenda";
    if (dateLabel) dateLabel.textContent = "Ticketmaster México";
    if (prevButton) prevButton.disabled = true;
    if (nextButton) nextButton.disabled = true;
  }

  async function loadEvents() {
    try {
      const response = await fetch("eventos.json", { cache: "no-cache" });
      if (!response.ok) throw new Error("No se pudo cargar eventos.json");
      const data = await response.json();
      const events = Array.isArray(data.events) ? data.events : [];

      state.events = events
        .filter(
          (event) =>
            event &&
            typeof event.name === "string" &&
            typeof event.start === "string" &&
            typeof event.url === "string"
        )
        .map((event) => ({
          ...event,
          dateKey: event.start.slice(0, 10),
        }))
        .filter((event) => event.dateKey >= todayKey)
        .sort((a, b) => a.start.localeCompare(b.start));

      state.updated = data.updated || "";

      if (!state.events.length) {
        showLoadError();
        return;
      }

      fillCities();
      setFilteredEvents();

      const first =
        state.events.find((event) => event.dateKey >= todayKey) ||
        state.events[0];
      state.selected = first.dateKey;
      state.month = keyToDate(`${first.dateKey.slice(0, 7)}-01`);

      render();
    } catch (error) {
      showLoadError();
    }
  }

  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cal-day]");
    if (!button) return;
    state.selected = button.dataset.calDay;
    state.expanded = false;
    renderCalendar();
    renderList();
    const selected = grid.querySelector(".cal-day.is-selected");
    if (selected) selected.focus({ preventScroll: true });
  });

  list.addEventListener("click", (event) => {
    const designButton = event.target.closest("[data-design-event]");
    if (designButton) {
      const text = designButton.dataset.designEvent;
      if (typeof window.likeHoodieDesignWith === "function") {
        window.likeHoodieDesignWith(text);
      } else {
        const section = document.querySelector("#personalizar");
        if (section) {
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
      return;
    }

    const nextEvent = event.target.closest("[data-next-event]");
    if (nextEvent) {
      state.selected = nextEvent.dataset.nextEvent;
      state.month = keyToDate(`${state.selected.slice(0, 7)}-01`);
      state.expanded = false;
      render();
      return;
    }

    const showAll = event.target.closest("[data-show-all]");
    if (showAll) {
      state.expanded = true;
      renderList();
    }
  });

  if (prevButton) {
    prevButton.addEventListener("click", () => {
      state.month = new Date(
        state.month.getFullYear(),
        state.month.getMonth() - 1,
        1
      );
      const first = state.filtered.find((event) =>
        event.dateKey.startsWith(monthKey(state.month))
      );
      if (first) state.selected = first.dateKey;
      state.expanded = false;
      render();
    });
  }

  if (nextButton) {
    nextButton.addEventListener("click", () => {
      state.month = new Date(
        state.month.getFullYear(),
        state.month.getMonth() + 1,
        1
      );
      const first = state.filtered.find((event) =>
        event.dateKey.startsWith(monthKey(state.month))
      );
      if (first) state.selected = first.dateKey;
      state.expanded = false;
      render();
    });
  }

  if (cityFilter) {
    cityFilter.addEventListener("change", () => {
      state.city = cityFilter.value;
      state.expanded = false;
      setFilteredEvents();
      selectNearestEvent();
      render();
    });
  }

  loadEvents();
})();
