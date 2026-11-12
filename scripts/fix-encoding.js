const fs = require('fs');

// Windows-1252: caracteres especiales por encima de 0x7F
const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

function toByte(ch) {
  const c = ch.codePointAt(0);
  if (c <= 0xff) return c;
  return CP1252.has(c) ? CP1252.get(c) : -1;
}

function fixMojibake(s) {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const b0 = toByte(s[i]);
    let length = 0;
    if (b0 >= 0xc2 && b0 <= 0xdf) length = 2;
    else if (b0 >= 0xe0 && b0 <= 0xef) length = 3;
    else if (b0 >= 0xf0 && b0 <= 0xf4) length = 4;

    if (length && i + length <= s.length) {
      const bytes = [b0];
      let ok = true;
      for (let k = 1; k < length; k++) {
        const b = toByte(s[i + k]);
        if (b < 0x80 || b > 0xbf) {
          ok = false;
          break;
        }
        bytes.push(b);
      }
      if (ok) {
        const dec = Buffer.from(bytes).toString('utf8');
        if (!dec.includes('\uFFFD')) {
          out += dec;
          i += length;
          continue;
        }
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

for (const f of process.argv.slice(2)) {
  let text = fs.readFileSync(f, 'utf8');
  const original = text;
  for (let pass = 0; pass < 4; pass++) {
    const next = fixMojibake(text);
    if (next === text) break;
    text = next;
  }
  if (text !== original) fs.writeFileSync(f, text, 'utf8');
  console.log(
    f,
    text !== original ? 'REPARADO' : 'sin cambios',
    '| quedan Ã:', text.includes('Ã'),
    '| â€:', text.includes('â€')
  );
}
