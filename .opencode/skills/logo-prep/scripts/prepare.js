#!/usr/bin/env node
/* logo-prep · Prepara un logo para impresión: recorta, quita el fondo uniforme,
   mide DPI y exporta PNG con transparencia.
   Uso:
     node prepare.js <logo.png> [--width-cm 28] [--dpi 300] [--out carpeta]
                     [--no-trim] [--no-cutout] [--upscale] [--name slug]
*/
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const HELP = `logo-prep · prepare

  node prepare.js <archivo> [opciones]

  --width-cm <n>   ancho de impresión en cm (por defecto 28)
  --dpi <n>        DPI objetivo (por defecto 300)
  --out <dir>      carpeta de salida (por defecto logo-prep-out)
  --name <slug>    nombre base de los archivos
  --no-trim        no recortar el borde sobrante
  --no-cutout      no eliminar el fondo uniforme (sin transparencia)
  --upscale        ampliar hasta 2x si no llega al DPI objetivo
  --help           esta ayuda
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (["no-trim", "no-cutout", "upscale", "help"].includes(key)) {
      args[key] = true;
    } else {
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function slugify(value) {
  return (
    String(value || "logo")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "logo"
  );
}

const clampByte = (value) => Math.max(0, Math.min(255, value));

function analyzeBorder(data, width, height) {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 220));
  const bins = new Map();
  const samples = [];

  const add = (x, y) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 16) {
      samples.push(-1);
      return;
    }
    const key =
      ((data[index] >> 4) << 8) |
      ((data[index + 1] >> 4) << 4) |
      (data[index + 2] >> 4);
    bins.set(key, (bins.get(key) || 0) + 1);
    samples.push(index);
  };

  for (let x = 0; x < width; x += step) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    add(0, y);
    add(width - 1, y);
  }

  if (!samples.length) {
    return { transparent: false, uniform: false, share: 0, color: null };
  }

  const transparentShare =
    samples.filter((sample) => sample < 0).length / samples.length;
  if (transparentShare >= 0.45) {
    return {
      transparent: true,
      uniform: true,
      share: Number(transparentShare.toFixed(3)),
      color: null,
    };
  }

  let bestKey = -1;
  let bestCount = 0;
  bins.forEach((count, key) => {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  });
  if (bestKey < 0) {
    return { transparent: false, uniform: false, share: 0, color: null };
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let matched = 0;
  samples.forEach((index) => {
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

  return {
    transparent: false,
    uniform: bestCount / samples.length >= 0.45,
    share: Number((bestCount / samples.length).toFixed(3)),
    color: matched
      ? {
          r: Math.round(r / matched),
          g: Math.round(g / matched),
          b: Math.round(b / matched),
        }
      : null,
  };
}

/* Elimina el fondo uniforme conectado al borde. */
function removeBackground(data, width, height, color, tolerance) {
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  let removed = 0;

  const matches = (index) => {
    const offset = index * 4;
    return (
      Math.abs(data[offset] - color.r) <= tolerance &&
      Math.abs(data[offset + 1] - color.g) <= tolerance &&
      Math.abs(data[offset + 2] - color.b) <= tolerance
    );
  };

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
    data[index * 4 + 3] = 0;
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

/* Quita el halo del fondo en los píxeles de borde y calcula alfa suave. */
function defringe(data, width, height, color, band, erode) {
  const total = width * height;
  const distance = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const maxDepth = band + erode;

  for (let index = 0; index < total; index += 1) {
    if (data[index * 4 + 3] === 0) {
      distance[index] = 255;
      queue[tail++] = index;
    }
  }

  let levelEnd = tail;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    while (head < levelEnd) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      const visit = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const next = ny * width + nx;
        if (distance[next] || data[next * 4 + 3] === 0) return;
        distance[next] = depth;
        queue[tail++] = next;
      };
      visit(x + 1, y);
      visit(x - 1, y);
      visit(x, y + 1);
      visit(x, y - 1);
    }
    levelEnd = tail;
  }

  const threshold = 150;
  for (let index = 0; index < total; index += 1) {
    const depth = distance[index];
    if (!depth || depth > maxDepth) continue;
    const offset = index * 4;
    const alpha = data[offset + 3];
    if (alpha === 0) continue;

    if (depth <= erode) {
      data[offset + 3] = 0;
      continue;
    }

    const diff = Math.max(
      Math.abs(data[offset] - color.r),
      Math.abs(data[offset + 1] - color.g),
      Math.abs(data[offset + 2] - color.b)
    );
    if (diff >= threshold) continue;

    const coverage = Math.max(0, diff / threshold);
    if (coverage < 0.08) {
      data[offset + 3] = 0;
      continue;
    }

    data[offset + 3] = Math.round(alpha * coverage);
    const unmix = (value, background) =>
      clampByte(Math.round((value - background * (1 - coverage)) / coverage));
    data[offset] = unmix(data[offset], color.r);
    data[offset + 1] = unmix(data[offset + 1], color.g);
    data[offset + 2] = unmix(data[offset + 2], color.b);
  }
}

async function renderRgba(inputPath, factor, baseWidth) {
  let pipeline = sharp(inputPath).rotate().ensureAlpha();
  if (factor > 1.02) {
    pipeline = pipeline.resize({
      width: Math.round(baseWidth * factor),
      kernel: "lanczos3",
    });
  }
  const { data, info } = await pipeline
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function cutout(rgba, border, enabled) {
  if (!enabled || !border.uniform || border.transparent || !border.color) {
    return { data: rgba.data, ratio: 0 };
  }
  const data = Buffer.from(rgba.data);
  const ratio = removeBackground(data, rgba.width, rgba.height, border.color, 26);
  defringe(data, rgba.width, rgba.height, border.color, 2, 3);
  return { data, ratio };
}

async function trimRgba(rgba, enabled) {
  const source = sharp(rgba.data, {
    raw: { width: rgba.width, height: rgba.height, channels: 4 },
  });
  if (!enabled) return rgba;
  try {
    const trimmed = await source
      .trim({ threshold: 12 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (trimmed.info.width >= 8 && trimmed.info.height >= 8) {
      return {
        data: trimmed.data,
        width: trimmed.info.width,
        height: trimmed.info.height,
      };
    }
  } catch (error) {
    /* imagen uniforme: se conserva completa */
  }
  return rgba;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args._.length) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const inputPath = path.resolve(args._[0]);
  if (!fs.existsSync(inputPath)) {
    console.error(`No existe el archivo: ${inputPath}`);
    process.exit(1);
  }

  const widthCm = Number(args["width-cm"] || 28);
  const targetDpi = Math.round(Number(args.dpi || 300));
  const outDir = path.resolve(args.out || "logo-prep-out");
  const name = args.name
    ? slugify(args.name)
    : slugify(path.basename(inputPath, path.extname(inputPath)));
  fs.mkdirSync(outDir, { recursive: true });

  const meta = await sharp(inputPath).metadata();
  const probe = await sharp(inputPath)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const border = analyzeBorder(probe.data, probe.info.width, probe.info.height);
  const shouldCut = !args["no-cutout"];

  const original = await renderRgba(inputPath, 1, meta.width);
  const originalCut = cutout(original, border, shouldCut);
  const logoSrc = await trimRgba(
    { data: originalCut.data, width: original.width, height: original.height },
    !args["no-trim"]
  );

  const naturalWidth = logoSrc.width;
  const naturalHeight = logoSrc.height;
  const dpiAtWidth = Math.round(naturalWidth / (widthCm / 2.54));

  let factor = 1;
  if (args.upscale && dpiAtWidth < targetDpi * 0.95) {
    factor = Math.min(2, targetDpi / dpiAtWidth);
  }

  let printSrc = logoSrc;
  if (factor > 1.02) {
    const upscaled = await renderRgba(inputPath, factor, meta.width);
    const upscaledCut = cutout(upscaled, border, shouldCut);
    printSrc = await trimRgba(
      { data: upscaledCut.data, width: upscaled.width, height: upscaled.height },
      !args["no-trim"]
    );
  }

  const printBuffer = await sharp(printSrc.data, {
    raw: { width: printSrc.width, height: printSrc.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .withMetadata({ density: targetDpi })
    .toBuffer();
  const logoBuffer = await sharp(logoSrc.data, {
    raw: { width: logoSrc.width, height: logoSrc.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .withMetadata({ density: targetDpi })
    .toBuffer();

  const printPath = path.join(outDir, `${name}-print.png`);
  const logoPath = path.join(outDir, `${name}-logo.png`);
  const reportPath = path.join(outDir, `${name}-report.json`);
  fs.writeFileSync(printPath, printBuffer);
  fs.writeFileSync(logoPath, logoBuffer);

  const printMeta = await sharp(printBuffer).metadata();
  const outputWidth = printMeta.width || printSrc.width;
  const outputHeight = printMeta.height || printSrc.height;
  const outputDpi = Math.round(outputWidth / (widthCm / 2.54));

  const targetWidthPx = Math.round((widthCm / 2.54) * targetDpi);
  const warnings = [];
  if (!border.transparent && !border.uniform) {
    warnings.push(
      "Fondo no uniforme: recorta a mano o usa una herramienta de recorte (rembg)."
    );
  }
  if (!meta.hasAlpha && !originalCut.ratio) {
    warnings.push(
      "La imagen no tiene transparencia y no se pudo quitar el fondo: revisa el borde."
    );
  }
  if (dpiAtWidth < 150) {
    warnings.push(
      `Resolución de origen muy baja: ${dpiAtWidth} DPI a ${widthCm} cm. Pide el logo original.`
    );
  } else if (dpiAtWidth < targetDpi && !args.upscale) {
    warnings.push(
      `${dpiAtWidth} DPI a ${widthCm} cm (ideal ${targetDpi}). Usa --upscale o imprime más pequeño.`
    );
  }
  if (args.upscale && dpiAtWidth < targetDpi && factor >= 2) {
    warnings.push("Ampliación limitada a 2x: el detalle no se recupera, solo se suaviza.");
  }
  if (outputDpi < targetDpi - 5) {
    warnings.push(
      `La salida queda en ${outputDpi} DPI a ${widthCm} cm; por debajo de ${targetDpi}.`
    );
  }

  const report = {
    input: inputPath,
    name,
    original: {
      width: meta.width,
      height: meta.height,
      format: meta.format,
      hasAlpha: Boolean(meta.hasAlpha),
    },
    cropped: {
      width: naturalWidth,
      height: naturalHeight,
      removedBorder:
        naturalWidth !== probe.info.width || naturalHeight !== probe.info.height,
    },
    border,
    cutout: {
      enabled: border.transparent || originalCut.ratio > 0,
      removedRatio: Number(originalCut.ratio.toFixed(3)),
      alpha: border.transparent || originalCut.ratio > 0,
    },
    print: {
      widthCm,
      targetDpi,
      dpiAtWidth,
      outputWidth,
      outputHeight,
      outputDpi,
      upscaleFactor: Number(factor.toFixed(2)),
      wideEnough: outputWidth >= targetWidthPx * 0.98,
    },
    files: [printPath, logoPath],
    warnings,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`✔ ${name}`);
  console.log(
    `  origen ${naturalWidth}×${naturalHeight}px · ${dpiAtWidth} DPI a ${widthCm} cm`
  );
  if (originalCut.ratio > 0) {
    console.log(`  fondo eliminado: ${Math.round(originalCut.ratio * 100)} %`);
  }
  console.log(
    `  salida ${outputWidth}×${outputHeight}px · ${outputDpi} DPI a ${widthCm} cm (PNG con alfa)`
  );
  console.log(`  ${printPath}`);
  console.log(`  ${logoPath}`);
  console.log(`  ${reportPath}`);
  warnings.forEach((warning) => console.log(`  ! ${warning}`));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
