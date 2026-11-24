// Genera i18n-store.js y i18n-admin.js a partir de los textos traducidos.
// Formato de cada línea:  texto en español ||| english text
// Las líneas vacías y las que empiezan por # se ignoran.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function build(source, target, title) {
  const file = path.join(root, source);
  if (!fs.existsSync(file)) {
    console.warn(`No existe ${source}; se omite.`);
    return;
  }

  const entries = [];
  const seen = new Set();
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("|||");
    if (index < 0) {
      console.warn(`Línea sin separador en ${source}: ${line.slice(0, 60)}`);
      continue;
    }
    const es = line.slice(0, index).trim();
    const en = line.slice(index + 3).trim();
    if (!es || !en) continue;
    if (seen.has(es)) {
      console.warn(`Duplicado en ${source}: ${es.slice(0, 60)}`);
      continue;
    }
    seen.add(es);
    entries.push([es, en]);
  }

  entries.sort((a, b) => a[0].localeCompare(b[0], "es"));
  const body = entries
    .map(([es, en]) => `  ${JSON.stringify(es)}: ${JSON.stringify(en)},`)
    .join("\n");

  const output = `// ${title}\n// Generado por scripts/build-i18n.mjs — no editar a mano.\nwindow.LH_I18N = window.LH_I18N || {};\nwindow.LH_I18N.en = Object.assign(window.LH_I18N.en || {}, {\n${body}\n});\n`;
  fs.writeFileSync(path.join(root, target), output, "utf8");
  console.log(`${target}: ${entries.length} traducciones`);
}

build("i18n/store.txt", "i18n-store.js", "like hoodie ♡ — diccionario de la tienda");
build("i18n/admin.txt", "i18n-admin.js", "like hoodie ♡ — diccionario del panel");
