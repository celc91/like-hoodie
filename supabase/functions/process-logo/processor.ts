/* Procesado de logos para DTG: recorte con alfa + ampliación a 300 DPI.
   Dos etapas para respetar los límites de Supabase Edge Functions. */

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface BorderInfo {
  transparent: boolean;
  uniform: boolean;
  share: number;
  color: Rgb | null;
}

export interface CutoutResult {
  png: Uint8Array;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  cutout: boolean;
  removedRatio: number;
  border: BorderInfo;
  warnings: string[];
}

export interface ResizeResult {
  png: Uint8Array;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  outputDpi: number;
  upscale: number;
  warnings: string[];
}

const MAX_PIXELS = 9_000_000;

type Pixels = Uint8Array | Uint8ClampedArray;

export function readImageSize(
  bytes: Uint8Array
): { width: number; height: number } | null {
  // PNG
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return { width, height };
      }
      offset += 2 + length;
    }
    return null;
  }

  // WebP: imagescript no lo decodifica.
  if (
    bytes.length > 16 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return null;
  }

  return null;
}

function analyzeBorder(
  data: Pixels,
  width: number,
  height: number
): BorderInfo {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 220));
  const bins = new Map<number, number>();
  const samples: number[] = [];

  const add = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 16) {
      samples.push(-1);
      return;
    }
    const key =
      ((data[index] >> 4) << 8) |
      ((data[index + 1] >> 4) << 4) |
      (data[index + 2] >> 4);
    bins.set(key, (bins.get(key) ?? 0) + 1);
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
      share: transparentShare,
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
    share: bestCount / samples.length,
    color: matched
      ? {
          r: Math.round(r / matched),
          g: Math.round(g / matched),
          b: Math.round(b / matched),
        }
      : null,
  };
}

function removeBackground(
  data: Pixels,
  width: number,
  height: number,
  color: Rgb,
  tolerance: number
) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  let removed = 0;

  const matches = (index: number) => {
    const offset = index * 4;
    return (
      Math.abs(data[offset] - color.r) <= tolerance &&
      Math.abs(data[offset + 1] - color.g) <= tolerance &&
      Math.abs(data[offset + 2] - color.b) <= tolerance
    );
  };

  const push = (x: number, y: number) => {
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

  return removed / total;
}

function defringe(
  data: Pixels,
  width: number,
  height: number,
  color: Rgb,
  band: number,
  erode: number
) {
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
      const visit = (nx: number, ny: number) => {
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
    const unmix = (value: number, background: number) =>
      Math.max(
        0,
        Math.min(
          255,
          Math.round((value - background * (1 - coverage)) / coverage)
        )
      );
    data[offset] = unmix(data[offset], color.r);
    data[offset + 1] = unmix(data[offset + 1], color.g);
    data[offset + 2] = unmix(data[offset + 2], color.b);
  }
}

function trimTransparent(image: Image) {
  const data = image.bitmap;
  const width = image.width;
  const height = image.height;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return;
  image.crop(minX, minY, maxX - minX + 1, maxY - minY + 1);
}

function premultiply(data: Pixels) {
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha === 0 || alpha === 255) continue;
    data[offset] = (data[offset] * alpha) / 255;
    data[offset + 1] = (data[offset + 1] * alpha) / 255;
    data[offset + 2] = (data[offset + 2] * alpha) / 255;
  }
}

function unpremultiply(data: Pixels) {
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha === 0) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      continue;
    }
    if (alpha === 255) continue;
    data[offset] = Math.min(255, Math.round((data[offset] * 255) / alpha));
    data[offset + 1] = Math.min(
      255,
      Math.round((data[offset + 1] * 255) / alpha)
    );
    data[offset + 2] = Math.min(
      255,
      Math.round((data[offset + 2] * 255) / alpha)
    );
  }
}

export async function cutoutStage(bytes: Uint8Array): Promise<CutoutResult> {
  const size = readImageSize(bytes);
  if (size && size.width * size.height > MAX_PIXELS) {
    throw new Error(
      `Imagen demasiado grande (${size.width}×${size.height}). Usa una de menos de 9 MP.`
    );
  }

  const image = await Image.decode(bytes);
  const width = image.width;
  const height = image.height;
  const border = analyzeBorder(image.bitmap, width, height);
  const warnings: string[] = [];
  let removed = 0;
  let cutout = false;

  if (border.uniform && !border.transparent && border.color) {
    removed = removeBackground(image.bitmap, width, height, border.color, 26);
    defringe(image.bitmap, width, height, border.color, 2, 3);
    cutout = true;
  } else if (!border.transparent) {
    warnings.push("Fondo no uniforme: se conserva el fondo original.");
  }

  trimTransparent(image);
  const png = await image.encode();

  return {
    png,
    width: image.width,
    height: image.height,
    sourceWidth: width,
    sourceHeight: height,
    cutout,
    removedRatio: removed,
    border,
    warnings,
  };
}

export async function resizeStage(
  bytes: Uint8Array,
  options: {
    widthCm: number;
    targetDpi: number;
    maxPx: number;
    maxUpscale: number;
  }
): Promise<ResizeResult> {
  const image = await Image.decode(bytes);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const required = Math.round((options.widthCm / 2.54) * options.targetDpi);
  const outWidth = Math.min(
    required,
    Math.round(sourceWidth * options.maxUpscale),
    options.maxPx
  );
  const outHeight = Math.max(
    1,
    Math.round((sourceHeight * outWidth) / sourceWidth)
  );
  const outputDpi = Math.round(outWidth / (options.widthCm / 2.54));
  const upscale = outWidth / sourceWidth;
  const warnings: string[] = [];

  if (outputDpi < 200) {
    warnings.push(
      `Resolución insuficiente: ${outputDpi} DPI a ${options.widthCm} cm.`
    );
  } else if (outputDpi < 280) {
    warnings.push(
      `Resolución interpolada: ${outputDpi} DPI a ${options.widthCm} cm.`
    );
  }

  if (outWidth !== sourceWidth || outHeight !== sourceHeight) {
    premultiply(image.bitmap);
    image.resize(outWidth, outHeight);
    unpremultiply(image.bitmap);
  }

  const png = await image.encode();
  return {
    png,
    width: image.width,
    height: image.height,
    sourceWidth,
    sourceHeight,
    outputDpi,
    upscale,
    warnings,
  };
}
