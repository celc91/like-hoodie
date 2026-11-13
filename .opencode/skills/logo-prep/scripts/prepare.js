#!/usr/bin/env node
/* logo-prep · Prepara un logo para impresión: recorta, mide DPI y exporta PNG.
   Uso:
     node prepare.js <logo.png> [--width-cm 28] [--dpi 300] [--out carpeta]
                     [--no-trim] [--upscale] [--name slug]
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
  --no-trim        no recortar el borde uniforme
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
    if (["no-trim", "upscale", "help"].includes(key)) {
      args[key] = true;
    } else {
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function slugify(value) {
  return String(value || "logo")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "logo";
}

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
  const name = args.name ? slugify(args.name) : slugify(path.basename(inputPath, path.extname(inputPath)));
  fs.mkdirSync(outDir, { recursive: true });

  const meta = await sharp(inputPath).metadata();
  const rotated = await sharp(inputPath)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const border = analyzeBorder(rotated.data, rotated.info.width, rotated.info.height);

  let croppedBuffer = null;
  if (!args["no-trim"]) {
    try {
      const cropped = await sharp(inputPath)
        .rotate()
        .trim({ threshold: 12 })
        .toBuffer({ resolveWithObject: true });
      if (cropped.info.width >= 8 && cropped.info.height >= 8) {
        croppedBuffer = cropped.data;
      }
    } catch (error) {
      /* imagen totalmente uniforme: se conserva el original */
    }
  }

  const base = croppedBuffer ? sharp(croppedBuffer) : sharp(inputPath).rotate();
  const baseMeta = await base.metadata();
  const naturalWidth = baseMeta.width || meta.width;
  const naturalHeight = baseMeta.height || meta.height;
  const dpiAtWidth = Math.round(naturalWidth / (widthCm / 2.54));

  let factor = 1;
  if (args.upscale && dpiAtWidth < targetDpi * 0.95) {
    factor = Math.min(2, targetDpi / dpiAtWidth);
  }

  let printPipeline = base.clone();
  if (factor > 1.02) {
    printPipeline = printPipeline.resize({
      width: Math.round(naturalWidth * factor),
      kernel: "lanczos3",
    });
  }

  const printBuffer = await printPipeline
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .withMetadata({ density: targetDpi })
    .toBuffer();
  const logoBuffer = await base
    .clone()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .withMetadata({ density: targetDpi })
    .toBuffer();

  const printPath = path.join(outDir, `${name}-print.png`);
  const logoPath = path.join(outDir, `${name}-logo.png`);
  const reportPath = path.join(outDir, `${name}-report.json`);
  fs.writeFileSync(printPath, printBuffer);
  fs.writeFileSync(logoPath, logoBuffer);

  const printMeta = await sharp(printBuffer).metadata();
  const outputWidth = printMeta.width || naturalWidth;
  const outputHeight = printMeta.height || naturalHeight;
  const outputDpi = Math.round(outputWidth / (widthCm / 2.54));

  const targetWidthPx = Math.round((widthCm / 2.54) * targetDpi);
  const warnings = [];
  if (!border.transparent && !border.uniform) {
    warnings.push(
      "Fondo no uniforme: recorta a mano o usa una herramienta de recorte (rembg)."
    );
  }
  if (!meta.hasAlpha && border.uniform && !border.transparent) {
    warnings.push(
      "La imagen no tiene transparencia: el fondo uniforme se recortó, pero revisa los bordes."
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
      removedBorder: Boolean(croppedBuffer),
    },
    border,
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
  console.log(`  origen ${naturalWidth}×${naturalHeight}px · ${dpiAtWidth} DPI a ${widthCm} cm`);
  console.log(`  salida ${outputWidth}×${outputHeight}px · ${outputDpi} DPI a ${widthCm} cm`);
  console.log(`  ${printPath}`);
  console.log(`  ${logoPath}`);
  console.log(`  ${reportPath}`);
  warnings.forEach((warning) => console.log(`  ! ${warning}`));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
