/* ==========================================================================
   like hoodie ♡ — Vectorizador de logos (prototipo en navegador)
   Motor: imagetracer.js 1.2.6 · Unlicense · vendor/imagetracer-1.2.6.js
   Todo ocurre en el dispositivo: el logo no se envía a ningún servidor.
   ========================================================================== */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LikeVectorize = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_TRACE_PX = 1000;
  const PRINT_WIDTH_CM = 28;
  const TARGET_DPI = 300;
  const MAX_COLORS = 8;
  const ALPHA_CUT = 40;
  const SENTINEL = { r: 255, g: 0, b: 255 };
  const BLACK = { r: 0, g: 0, b: 0 };

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
  /* ------------------------------------------------------------------ */

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const luminance = (r, g, b) =>
    typeof r === "object" ? luminance(r.r, r.g, r.b) : 0.299 * r + 0.587 * g + 0.114 * b;

  const now = () =>
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();

  function parseHex(value) {
    if (typeof value !== "string") return null;
    const hex = value.trim().replace("#", "");
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((part) => part + part)
            .join("")
        : hex;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  function getEngine() {
    const engine =
      typeof self !== "undefined" && self.ImageTracer
        ? self.ImageTracer
        : typeof globalThis !== "undefined" && globalThis.ImageTracer
          ? globalThis.ImageTracer
          : null;
    if (!engine) {
      throw new Error("Falta el motor de vectorización (imagetracer.js).");
    }
    return engine;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("No se pudo leer la imagen."));
      image.src = src;
    });
  }

  const distance = (a, b) =>
    Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

  /* ------------------------------------------------------------------ */
  /* Análisis de la imagen                                               */
  /* ------------------------------------------------------------------ */

  function analyzeImageData(imgd) {
    const { data } = imgd;
    const bins = new Map();
    let opaque = 0;
    let transparent = 0;
    let lumSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 16) {
        transparent += 1;
        continue;
      }
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      opaque += 1;
      lumSum += luminance(r, g, b);
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      bins.set(key, (bins.get(key) || 0) + 1);
    }

    const total = data.length / 4;
    const minShare = Math.max(2, opaque * 0.012);
    let significantColors = 0;
    let speckles = 0;
    bins.forEach((count) => {
      if (count >= minShare) significantColors += 1;
      else speckles += count;
    });

    return {
      total,
      opaque,
      transparentRatio: total ? transparent / total : 0,
      uniqueColors: bins.size,
      significantColors,
      noiseRatio: opaque ? speckles / opaque : 0,
      meanLuminance: opaque ? lumSum / opaque : 255,
    };
  }

  function detectBorderColor(imgd) {
    const { data, width, height } = imgd;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 220));
    const bins = new Map();
    const border = [];

    const add = (x, y) => {
      const index = (y * width + x) * 4;
      if (data[index + 3] < ALPHA_CUT) {
        border.push(-1);
        return;
      }
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      bins.set(key, (bins.get(key) || 0) + 1);
      border.push(index);
    };

    for (let x = 0; x < width; x += step) {
      add(x, 0);
      add(x, height - 1);
    }
    for (let y = 0; y < height; y += step) {
      add(0, y);
      add(width - 1, y);
    }

    if (!border.length) return null;

    const transparentShare = border.filter((index) => index < 0).length / border.length;
    if (transparentShare >= 0.45) {
      return { transparent: true, share: transparentShare, color: null };
    }

    let bestKey = -1;
    let bestCount = 0;
    bins.forEach((count, key) => {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    });
    if (bestKey < 0) return null;

    let r = 0;
    let g = 0;
    let b = 0;
    let matched = 0;
    border.forEach((index) => {
      if (index < 0) return;
      const key =
        ((data[index] >> 4) << 8) |
        ((data[index + 1] >> 4) << 4) |
        (data[index + 2] >> 4);
      if (key !== bestKey) return;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      matched += 1;
    });
    if (!matched) return null;

    return {
      transparent: false,
      share: bestCount / border.length,
      color: {
        r: Math.round(r / matched),
        g: Math.round(g / matched),
        b: Math.round(b / matched),
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Preparación de píxeles                                              */
  /* ------------------------------------------------------------------ */

  function compositeColor(analysis, garmentHex) {
    if (analysis.transparentRatio <= 0.02) {
      return { r: 255, g: 255, b: 255 };
    }
    const garment = parseHex(garmentHex) || { r: 255, g: 255, b: 255 };
    const garmentLum = luminance(garment);
    // Logo claro sobre fondo transparente: se compone sobre el color de la prenda.
    if (analysis.meanLuminance > 165) {
      return garmentLum < 150 ? garment : { r: 30, g: 30, b: 32 };
    }
    return { r: 255, g: 255, b: 255 };
  }

  function flatten(imgd) {
    const out = {
      width: imgd.width,
      height: imgd.height,
      data: new Uint8ClampedArray(imgd.data),
    };
    const data = out.data;
    for (let i = 0; i < data.length; i += 4) {
      // Para vectorizar interesa el borde duro: alfa < 50 % es fondo, el resto conserva su color.
      if (data[i + 3] < 128) {
        data[i] = SENTINEL.r;
        data[i + 1] = SENTINEL.g;
        data[i + 2] = SENTINEL.b;
      }
      data[i + 3] = 255;
    }
    return out;
  }

  function floodFillBorder(imgd, tolerance) {
    const { data, width, height } = imgd;
    const border = detectBorderColor(imgd);
    if (!border || border.transparent || border.share < 0.45) return 0;
    const target = border.color;

    const visited = new Uint8Array(width * height);
    const stack = new Int32Array(width * height);
    let top = 0;
    let removed = 0;

    const matches = (index) =>
      Math.abs(data[index * 4] - target.r) <= tolerance &&
      Math.abs(data[index * 4 + 1] - target.g) <= tolerance &&
      Math.abs(data[index * 4 + 2] - target.b) <= tolerance;

    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const index = y * width + x;
      if (visited[index] || !matches(index)) return;
      visited[index] = 1;
      stack[top++] = index;
    };

    for (let x = 0; x < width; x += 1) {
      push(x, 0);
      push(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
      push(0, y);
      push(width - 1, y);
    }

    while (top > 0) {
      const index = stack[--top];
      const offset = index * 4;
      data[offset] = SENTINEL.r;
      data[offset + 1] = SENTINEL.g;
      data[offset + 2] = SENTINEL.b;
      removed += 1;
      const x = index % width;
      const y = (index - x) / width;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }

    return removed / (width * height);
  }

  function otsuThreshold(imgd) {
    const { data } = imgd;
    const histogram = new Array(256).fill(0);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < ALPHA_CUT) continue;
      const value = Math.round(luminance(data[i], data[i + 1], data[i + 2]));
      histogram[value] += 1;
      total += 1;
    }
    if (!total) return 128;

    let sum = 0;
    for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
    let sumB = 0;
    let weightB = 0;
    let best = 128;
    let bestVariance = -1;
    for (let i = 0; i < 256; i += 1) {
      weightB += histogram[i];
      if (!weightB) continue;
      const weightF = total - weightB;
      if (!weightF) break;
      sumB += i * histogram[i];
      const meanB = sumB / weightB;
      const meanF = (sum - sumB) / weightF;
      const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
      if (variance > bestVariance) {
        bestVariance = variance;
        best = i;
      }
    }
    return best;
  }

  /* Máscara de una tinta: silueta del logo, sin grises ni ruido de borde. */
  function buildMonoMask(imgd, threshold, border) {
    const { data, width, height } = imgd;
    const out = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    };
    const target = out.data;
    const bg = border && !border.transparent ? border.color : null;
    const bgLight = bg ? luminance(bg) >= 128 : true;

    let inkCount = 0;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      let ink = false;

      if (alpha >= ALPHA_CUT) {
        if (!bg) {
          ink = true;
        } else {
          const lum = luminance(data[i], data[i + 1], data[i + 2]);
          ink = bgLight ? lum < threshold : lum > threshold;
        }
      }

      if (ink) {
        target[i] = BLACK.r;
        target[i + 1] = BLACK.g;
        target[i + 2] = BLACK.b;
        inkCount += 1;
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
      } else {
        target[i] = SENTINEL.r;
        target[i + 1] = SENTINEL.g;
        target[i + 2] = SENTINEL.b;
      }
      target[i + 3] = 255;
    }

    return {
      imageData: out,
      inkRatio: inkCount / (width * height),
      inkColor: inkCount
        ? {
            r: Math.round(rSum / inkCount),
            g: Math.round(gSum / inkCount),
            b: Math.round(bSum / inkCount),
          }
        : { r: 0, g: 0, b: 0 },
    };
  }

  function prepare(imgd, options) {
    const analysis = options.analysis;
    const mode = options.mode === "mono" ? "mono" : "color";
    const border = detectBorderColor(imgd);
    const composite = compositeColor(analysis, options.garment);

    if (mode === "mono") {
      const threshold =
        typeof options.threshold === "number" && isFinite(options.threshold)
          ? clamp(options.threshold, 1, 254)
          : otsuThreshold(imgd);
      const mask = buildMonoMask(imgd, threshold, border);
      return {
        imageData: mask.imageData,
        threshold,
        inkColor: mask.inkColor,
        inkRatio: mask.inkRatio,
        removedRatio: 1 - mask.inkRatio,
        composite,
        border,
      };
    }

    const prepared = flatten(imgd);
    let removedRatio = 0;
    if (border && !border.transparent && border.share >= 0.45) {
      removedRatio = floodFillBorder(prepared, 26);
    }

    return {
      imageData: prepared,
      threshold: null,
      inkColor: null,
      inkRatio: null,
      removedRatio,
      composite,
      border,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Trazado                                                            */
  /* ------------------------------------------------------------------ */

  function chooseColorCount(analysis) {
    const unique = analysis.uniqueColors;
    if (unique > 1200) return 8;
    if (unique > 400) return 7;
    if (unique > 150) return 6;
    if (unique > 60) return 4;
    return clamp(Math.max(2, analysis.significantColors + 1), 2, 4);
  }

  function countPreparedColors(imgd) {
    const { data } = imgd;
    const bins = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key =
        ((data[i] >> 3) << 10) |
        ((data[i + 1] >> 3) << 5) |
        (data[i + 2] >> 3);
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    const minPixels = (data.length / 4) * 0.003;
    let count = 0;
    bins.forEach((pixels) => {
      if (pixels >= minPixels) count += 1;
    });
    return count;
  }

  /* Paleta propia: los N colores reales con más superficie, sin duplicados.
     Evita que el muestreo aleatorio se coma colores pequeños pero importantes. */
  function buildPalette(imgd, maxColors) {    const { data, width, height } = imgd;
    const bins = new Map();

    for (let i = 0; i < data.length; i += 4) {
      const key =
        ((data[i] >> 3) << 10) |
        ((data[i + 1] >> 3) << 5) |
        (data[i + 2] >> 3);
      let entry = bins.get(key);
      if (!entry) {
        entry = { r: 0, g: 0, b: 0, count: 0 };
        bins.set(key, entry);
      }
      entry.r += data[i];
      entry.g += data[i + 1];
      entry.b += data[i + 2];
      entry.count += 1;
    }

    const colors = [];
    bins.forEach((entry) => {
      colors.push({
        r: Math.round(entry.r / entry.count),
        g: Math.round(entry.g / entry.count),
        b: Math.round(entry.b / entry.count),
        count: entry.count,
      });
    });
    colors.sort((a, b) => b.count - a.count);

    const palette = [];
    const minPixels = width * height * 0.002;
    for (const color of colors) {
      if (palette.length >= maxColors) break;
      if (color.count < minPixels) continue;
      if (palette.some((item) => distance(item, color) < 48)) continue;
      palette.push({ r: color.r, g: color.g, b: color.b, a: 255 });
    }
    return palette;
  }

  function traceOptions(mode, palette) {
    if (mode === "mono") {
      return {
        ltres: 1,
        qtres: 1,
        pathomit: 4,
        rightangleenhance: true,
        colorsampling: 0,
        numberofcolors: 2,
        mincolorratio: 0,
        colorquantcycles: 1,
        layering: 1,
        strokewidth: 0,
        linefilter: false,
        scale: 1,
        roundcoords: 1,
        viewbox: true,
        desc: false,
        blurradius: 0,
        blurdelta: 20,
        pal: [
          { r: 0, g: 0, b: 0, a: 255 },
          { r: SENTINEL.r, g: SENTINEL.g, b: SENTINEL.b, a: 255 },
        ],
      };
    }
    return {
      ltres: 1.2,
      qtres: 1.2,
      pathomit: 8,
      rightangleenhance: true,
      colorsampling: 0,
      numberofcolors: palette ? palette.length : 8,
      mincolorratio: 0,
      colorquantcycles: palette ? 2 : 3,
      layering: 1,
      strokewidth: 0,
      linefilter: false,
      scale: 1,
      roundcoords: 1,
      viewbox: true,
      desc: false,
      blurradius: 0,
      blurdelta: 20,
      pal: palette || undefined,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Limpieza del SVG                                                   */
  /* ------------------------------------------------------------------ */

  const fillOf = (path) => {
    const match = path.match(/fill="rgb\((\d+),(\d+),(\d+)\)"/);
    return match
      ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
      : null;
  };

  const cleanPath = (path) =>
    path
      .replace(/\sstroke="rgb\([^)]*\)"/, "")
      .replace(/\sstroke-width="[^"]*"/, "")
      .replace(/\sopacity="[^"]*"/, "");

  function cleanupSvg(svgRaw, width, height, options) {
    options = options || {};
    const paths = svgRaw.match(/<path\b[^>]*\/>/g) || [];
    const keepOnly = options.keepOnly || null;
    let removeTarget = null;

    if (!keepOnly) {
      // Quita el color más cercano al centinela (el fondo sintético).
      let best = Infinity;
      paths.forEach((path) => {
        const color = fillOf(path);
        if (!color) return;
        const diff = distance(color, SENTINEL);
        if (diff < best) {
          best = diff;
          removeTarget = color;
        }
      });
      if (best > 160) removeTarget = null;
    }

    const kept = [];
    paths.forEach((path) => {
      const color = fillOf(path);
      if (!color) return;
      if (keepOnly && distance(color, keepOnly) > 24) return;
      if (removeTarget && distance(color, removeTarget) <= 2) return;
      kept.push(cleanPath(path));
    });

    let body = kept;
    if (options.inkColor) {
      const ink = `rgb(${options.inkColor.r},${options.inkColor.g},${options.inkColor.b})`;
      body = kept.map((path) =>
        path.replace(/fill="rgb\(0,0,0\)"/, `fill="${ink}"`)
      );
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `preserveAspectRatio="xMidYMid meet">` +
      body.join("") +
      `</svg>`
    );
  }

  function svgMetrics(svg) {
    const matches = svg.match(/<path\b[^>]*>/g) || [];
    let nodes = 0;
    const palette = new Set();
    matches.forEach((path) => {
      const d = (path.match(/\sd="([^"]*)"/) || [])[1] || "";
      nodes += (d.match(/[MLCQ]/g) || []).length;
      const fill = (path.match(/fill="rgb\((\d+),(\d+),(\d+)\)"/) || [])
        .slice(1)
        .join(",");
      if (fill) palette.add(fill);
    });
    return {
      paths: matches.length,
      nodes,
      colors: palette.size,
      bytes:
        typeof TextEncoder !== "undefined"
          ? new TextEncoder().encode(svg).length
          : svg.length,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Diagnóstico                                                        */
  /* ------------------------------------------------------------------ */

  function qualityReport(analysis, metrics, mode) {
    const reasons = [];
    let level = "good";

    const photographic =
      mode === "color" &&
      analysis.uniqueColors > 1200 &&
      analysis.noiseRatio > 0.25;

    if (photographic) {
      level = "bad";
      reasons.push(
        "Parece una foto o un degradado: el vector va a salir sucio. Mejor DTG/DTF con el original."
      );
    }

    if (!photographic && mode === "color" && metrics.colors > 8) {
      if (level !== "bad") level = "warn";
      reasons.push(
        `${metrics.colors} colores detectados: para serigrafía conviene reducirlos.`
      );
    }

    if (metrics.nodes > 9000) {
      if (level !== "bad") level = "warn";
      reasons.push("Muchos nodos: el trazo puede quedar irregular. Revisa el resultado.");
    }

    if (metrics.paths > 600) {
      if (level !== "bad") level = "warn";
      reasons.push("Muchos trazos sueltos: el archivo puede venir de una imagen con ruido.");
    }

    if (!reasons.length) {
      reasons.push("Buen candidato a vector: formas planas y pocos colores.");
    }

    return { level, reasons };
  }

  /* ------------------------------------------------------------------ */
  /* API principal                                                      */
  /* ------------------------------------------------------------------ */

  function vectorizeImageData(imgd, options) {
    options = options || {};
    const started = now();
    const mode = options.mode === "mono" ? "mono" : "color";
    const analysis = analyzeImageData(imgd);
    const prepared = prepare(imgd, {
      analysis,
      mode,
      threshold: options.threshold,
      garment: options.garment,
    });

    if (mode === "mono" && prepared.inkRatio < 0.002) {
      throw new Error(
        "No encontramos tinta: el logo es del mismo color que el fondo. Prueba el modo color o sube otra versión."
      );
    }

    const colorCount =
      mode === "mono"
        ? 2
        : clamp(
            Math.max(
              chooseColorCount(analysis),
              countPreparedColors(prepared.imageData)
            ),
            3,
            MAX_COLORS
          );
    const palette =
      mode === "mono"
        ? null
        : buildPalette(prepared.imageData, colorCount);
    const raw = getEngine().imagedataToSVG(
      prepared.imageData,
      traceOptions(mode, palette && palette.length ? palette : null)
    );
    const svg = cleanupSvg(raw, imgd.width, imgd.height, {
      keepOnly: mode === "mono" ? BLACK : null,
      inkColor: mode === "mono" ? prepared.inkColor : null,
    });
    const metrics = svgMetrics(svg);

    const natural = options.natural || {
      width: imgd.width,
      height: imgd.height,
    };
    const dpi = Math.round(natural.width / (PRINT_WIDTH_CM / 2.54));
    const quality = qualityReport(analysis, metrics, mode);

    return {
      svg,
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      mode,
      width: natural.width,
      height: natural.height,
      traced: { width: imgd.width, height: imgd.height },
      analysis,
      metrics,
      quality,
      background: prepared.border,
      composite: prepared.composite,
      threshold: prepared.threshold,
      inkColor: prepared.inkColor,
      removedRatio: prepared.removedRatio,
      print: {
        widthCm: PRINT_WIDTH_CM,
        dpi,
        targetDpi: TARGET_DPI,
      },
      elapsed: Math.round(now() - started),
    };
  }

  async function vectorize(source, options) {
    options = options || {};
    if (typeof document === "undefined") {
      throw new Error("La vectorización necesita un navegador.");
    }
    const image = await loadImage(source);
    const natural = {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
    if (!natural.width || !natural.height) {
      throw new Error("La imagen está vacía.");
    }

    const maxPx = options.maxTracePx || MAX_TRACE_PX;
    const scale = Math.min(1, maxPx / Math.max(natural.width, natural.height));
    const width = Math.max(1, Math.round(natural.width * scale));
    const height = Math.max(1, Math.round(natural.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No se pudo preparar el lienzo.");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const imgd = context.getImageData(0, 0, width, height);
    return vectorizeImageData(imgd, { ...options, natural });
  }

  return {
    vectorize,
    vectorizeImageData,
    analyzeImageData,
    detectBorderColor,
    svgMetrics,
    qualityReport,
    PRINT_WIDTH_CM,
  };
});
