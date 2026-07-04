// Deriva los assets de marca OPTIMIZADOS para web desde los masters de
// public/brand/ (PNG 2048² con fondo blanco OPACO "quemado"). Requiere sharp +
// png-to-ico (devDependencies).
//   npm run brand:assets
//
// Los logos salen con FONDO TRANSPARENTE: quitamos el blanco por "cobertura"
// (qué tan lejos de blanco está cada pixel) y des-premultiplicamos contra
// blanco para que los bordes anti-alias queden limpios sobre cualquier fondo.
//
// Salidas (public/ y public/brand/):
//   brand/aria-mark.png (160, navy, transp.)   → logo del sidebar
//   brand/aria-mark-white.png (160, blanco, transp.) → splash/login/emails sobre navy
//   brand/aria-lockup.png (~720, transp.)       → login/emails/firmas
//   favicon-16/32/48.png + favicon.ico          → pestaña (desde la "A" sólida, legible)
//   apple-touch-icon.png (180)                  → iOS
//   icon-192/512.png (any) + icon-192/512-maskable.png → PWA (Android no recorta)
//   og-image.jpg (1200×630)                     → preview de links
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const B = path.join(root, "public", "brand");
const OUT = path.join(root, "public");
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const NAVY = "#2C5698"; // navy de marca (README)

/**
 * Quita el fondo blanco de un master → sharp con alpha real.
 * cobertura a = (255 - min(r,g,b)) / T  (0 en blanco, 1 en cualquier color
 * saturado/oscuro — sirve para navy Y teal). Luego des-premultiplica contra
 * blanco. Si `recolor` se pasa, fuerza ese color (para la versión blanca).
 */
async function keyOutWhite(inputPath, recolor = null) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);
  const T = 225;
  for (let i = 0, j = 0; i < data.length; i += channels, j += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let a = (255 - Math.min(r, g, b)) / T;
    if (a > 1) a = 1;
    if (a < 0.012) {
      out[j] = out[j + 1] = out[j + 2] = out[j + 3] = 0;
      continue;
    }
    if (recolor) {
      out[j] = recolor[0];
      out[j + 1] = recolor[1];
      out[j + 2] = recolor[2];
    } else {
      const inv = (1 - a) * 255;
      out[j] = Math.max(0, Math.min(255, (r - inv) / a));
      out[j + 1] = Math.max(0, Math.min(255, (g - inv) / a));
      out[j + 2] = Math.max(0, Math.min(255, (b - inv) / a));
    }
    out[j + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width, height, channels: 4 } });
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function main() {
  // ── Logos con fondo transparente (isotipo "AR"), CENTRADOS ──
  // `fit:contain` de sharp NO centra bien un recorte no-cuadrado (lo pega a una
  // esquina). Componemos el recorte ajustado sobre un lienzo transparente
  // cuadrado con gravity:centre → centrado garantizado.
  // Recorte TIGHT manual: `sharp.trim()` deja padding por el alpha tenue que
  // deja el keying en zonas casi-blancas del master. Escaneamos el bbox de los
  // pixeles con alpha > 24 y extraemos exactamente eso → recorte ajustado.
  const tightBuf = async (inputPath, recolor) => {
    const { data, info } = await (await keyOutWhite(inputPath, recolor))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = info.width,
      H = info.height;
    let minX = W,
      minY = H,
      maxX = 0,
      maxY = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    return sharp(data, { raw: { width: W, height: H, channels: 4 } })
      .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
      .png()
      .toBuffer();
  };
  // Centra un recorte ajustado en un lienzo cuadrado transparente (gravity:centre).
  const centerOnCanvas = async (tight, size, frac) => {
    const inner = Math.round(size * frac);
    const resized = await sharp(tight)
      .resize(inner, inner, { fit: "inside" })
      .png()
      .toBuffer();
    return sharp({
      create: { width: size, height: size, channels: 4, background: TRANSPARENT },
    })
      .composite([{ input: resized, gravity: "centre" }])
      .png({ compressionLevel: 9 });
  };

  const markNavyBuf = await tightBuf(path.join(B, "aria-isotipo.png"), null);
  await (await centerOnCanvas(markNavyBuf, 160, 0.86)).toFile(path.join(B, "aria-mark.png"));

  const markWhiteBuf = await tightBuf(path.join(B, "aria-isotipo.png"), [255, 255, 255]);
  await (await centerOnCanvas(markWhiteBuf, 160, 0.86)).toFile(
    path.join(B, "aria-mark-white.png"),
  );

  // ── Lockup horizontal transparente + optimizado ──
  await (await keyOutWhite(path.join(B, "aria-lockup-horizontal.png")))
    .trim()
    .resize(720, null, { fit: "inside" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(B, "aria-lockup.png"));

  // ── Favicon: "A" sólida BLANCA sobre un squircle con gradiente navy->teal
  //    (esquinas transparentes → nada de fondo blanco feo; se ve bien en
  //    pestañas claras y oscuras). Legible a 16px. ──
  const solidAWhite = await tightBuf(path.join(B, "aria-favicon-solidA.png"), [255, 255, 255]);
  const GRAD_SQUIRCLE = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#2c5698"/><stop offset="1" stop-color="#158a8c"/>` +
      `</linearGradient></defs>` +
      `<rect width="512" height="512" rx="116" fill="url(#g)"/></svg>`,
  );
  const faviconPng = async (size) => {
    const bg = await sharp(GRAD_SQUIRCLE).resize(size, size).png().toBuffer();
    const inner = Math.round(size * 0.56);
    const a = await sharp(solidAWhite).resize(inner, inner, { fit: "inside" }).png().toBuffer();
    return sharp(bg)
      .composite([{ input: a, gravity: "centre" }])
      .png({ compressionLevel: 9 });
  };
  for (const s of [16, 32, 48]) await (await faviconPng(s)).toFile(path.join(OUT, `favicon-${s}.png`));

  // favicon.ico multi-resolución (16+32+48)
  const icoBufs = await Promise.all([16, 32, 48].map(async (s) => (await faviconPng(s)).toBuffer()));
  writeFileSync(path.join(OUT, "favicon.ico"), await pngToIco(icoBufs));

  // ── App icon (squircle) → apple-touch + PWA "any". Trim suave + contain
  //    (contain PADDEA, no clipa las esquinas del squircle). ──
  const appTrim = await sharp(path.join(B, "aria-app-icon.png"))
    .trim({ threshold: 28 })
    .toBuffer();
  const iconAny = (size, name, opts = {}) =>
    sharp(appTrim)
      .resize(size, size, { fit: "contain", background: WHITE })
      .flatten({ background: WHITE })
      .png({ compressionLevel: 9, ...opts })
      .toFile(path.join(OUT, name));
  await iconAny(180, "apple-touch-icon.png");
  await iconAny(192, "icon-192.png");
  await iconAny(512, "icon-512.png", { quality: 82, palette: true, effort: 10 });

  // ── Maskable (Android): monograma blanco a ~60% sobre navy a sangre ──
  const maskable = async (size, name) => {
    const inner = Math.round(size * 0.6);
    const mark = await sharp(markWhiteBuf)
      .resize(inner, inner, { fit: "inside" })
      .png()
      .toBuffer();
    await sharp({
      create: { width: size, height: size, channels: 4, background: NAVY },
    })
      .composite([{ input: mark, gravity: "center" }])
      .png({ compressionLevel: 9, quality: 82, palette: true })
      .toFile(path.join(OUT, name));
  };
  await maskable(192, "icon-192-maskable.png");
  await maskable(512, "icon-512-maskable.png");

  // ── Preview social ──
  await sharp(path.join(B, "aria-banner.png"))
    .resize(1200, 630, { fit: "cover" })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(OUT, "og-image.jpg"));

  console.log("brand assets generated ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
