#!/usr/bin/env node
/* logo-prep · Vectoriza un logo con el mismo motor que la tienda.
   Uso:
     node trace.js <logo.png> [--mode color|mono|both] [--garment "#1c1c1f"]
                    [--width-cm 28] [--out carpeta] [--name slug] [--max-px 1000]
*/
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const PROJECT_ROOT = (() => {
  let dir = process.cwd();
  for (let depth = 0; depth < 10; depth += 1) {
    const hasVectorizer = fs.existsSync(path.join(dir, "vectorize.js"));
    const hasTracer = fs.existsSync(
      path.join(dir, "vendor/imagetracer-1.2.6.js")
    );
    if (hasVectorizer && hasTracer) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
})();
const HELP = `logo-prep · trace

  node trace.js <archivo> [opciones]

  --mode <color|mono|both>  por defecto both
  --garment <#hex>          color de la prenda (por defecto #1c1c1f)
  --width-cm <n>            ancho de impresión en cm (por defecto 28)
  --max-px <n>              resolución de trazado (por defecto 1000)
  --out <dir>               carpeta de salida (por defecto logo-prep-out)
  --name <slug>             nombre base de los archivos
  --help                    esta ayuda

  Sale con código 2 si el resultado necesita revisión humana.
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
    if (key === "help") args.help = true;
    else {
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

function validateSvg(svg) {
  const head = svg.slice(0, 200);
  return {
    startsWithSvg: svg.startsWith("<svg"),
    hasSize: /width="\d+"/.test(head) && /height="\d+"/.test(head),
    hasViewBox: /viewBox="0 0 \d+ \d+"/.test(head),
    noSentinel: !/rgb\(255,\s*0,\s*255\)/.test(svg),
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
  if (!PROJECT_ROOT) {
    console.error(
      "No encuentro vectorize.js. Ejecuta este script desde la raíz del proyecto like hoodie."
    );
    process.exit(1);
  }

  globalThis.ImageTracer = require(path.join(
    PROJECT_ROOT,
    "vendor/imagetracer-1.2.6.js"
  ));
  const vectorizer = require(path.join(PROJECT_ROOT, "vectorize.js"));

  const modeArg = String(args.mode || "both").toLowerCase();
  const modes =
    modeArg === "both"
      ? ["color", "mono"]
      : modeArg === "mono"
        ? ["mono"]
        : ["color"];
  const garment = args.garment || "#1c1c1f";
  const widthCm = Number(args["width-cm"] || 28);
  const maxPx = Number(args["max-px"] || 1000);
  const outDir = path.resolve(args.out || "logo-prep-out");
  const name = args.name
    ? slugify(args.name)
    : slugify(path.basename(inputPath, path.extname(inputPath)));
  fs.mkdirSync(outDir, { recursive: true });

  const meta = await sharp(inputPath).metadata();
  const scale = Math.min(1, maxPx / Math.max(meta.width, meta.height));
  let pipeline = sharp(inputPath).ensureAlpha();
  if (scale < 1) {
    pipeline = pipeline.resize({
      width: Math.max(1, Math.round(meta.width * scale)),
      height: Math.max(1, Math.round(meta.height * scale)),
      fit: "fill",
    });
  }
  const raw = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const imageData = {
    width: raw.info.width,
    height: raw.info.height,
    data: raw.data,
  };

  const dpiAtWidth = Math.round(meta.width / (widthCm / 2.54));
  const report = {
    input: inputPath,
    name,
    source: { width: meta.width, height: meta.height, dpiAtWidth },
    tracedAt: { width: imageData.width, height: imageData.height },
    modes: {},
    ok: true,
  };

  modes.forEach((mode) => {
    const result = vectorizer.vectorizeImageData(imageData, {
      mode,
      garment,
      natural: { width: meta.width, height: meta.height },
    });
    const svgPath = path.join(outDir, `${name}-${mode}.svg`);
    fs.writeFileSync(svgPath, result.svg);

    const validity = validateSvg(result.svg);
    const valid =
      validity.startsWithSvg &&
      validity.hasSize &&
      validity.hasViewBox &&
      validity.noSentinel &&
      (mode !== "mono" || result.metrics.colors === 1);

    report.modes[mode] = {
      file: svgPath,
      mode: result.mode,
      colors: result.metrics.colors,
      paths: result.metrics.paths,
      nodes: result.metrics.nodes,
      kilobytes: Math.round(result.metrics.bytes / 1024),
      elapsedMs: result.elapsed,
      quality: result.quality,
      validity,
      valid,
    };
    if (!valid || result.quality.level === "bad") report.ok = false;

    console.log(`✔ ${name} · ${mode}`);
    console.log(
      `  ${result.metrics.colors} colores · ${result.metrics.paths} trazos · ` +
        `${result.metrics.nodes} nodos · ${Math.round(result.metrics.bytes / 1024)} KB`
    );
    console.log(`  ${svgPath}`);
    result.quality.reasons.forEach((reason) =>
      console.log(`  ${result.quality.level === "good" ? "·" : "!"} ${reason}`)
    );
    if (!valid) console.log("  ! Validación SVG fallida: revisa el archivo");
  });

  const reportPath = path.join(outDir, `${name}-vector-report.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`  ${reportPath}`);
  if (!report.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
