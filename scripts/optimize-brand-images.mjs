// Optimiza IN-PLACE los PNG maestros de public/brand/ (PERF-A3).
//   node scripts/optimize-brand-images.mjs
//
// Los masters venían a 2048² (~2.5-4.6 MB c/u) con fondo blanco OPACO quemado.
// Son FUENTES: scripts/gen-brand-assets.mjs los re-muestrea a derivados web
// (el mayor es icon-512 a 512px, el lockup a 720px). Por eso 768px de master
// da margen ~1.5x de sobra para cualquier derivado, sin pérdida visible.
//
// Regla conservadora: NO cambiamos nombre ni extensión (no rompemos refs).
// Sobre el ALFA: los masters son OPACOS (isOpaque=true, fondo blanco quemado);
// su canal alfa está lleno y es redundante. sharp lo descarta legítimamente al
// escribir un PNG opaco (queda ch=3) — con o sin paleta. No pasa nada: el keying
// de gen-brand-assets lee r,g,b y hace ensureAlpha() para RECREAR la
// transparencia por cobertura. O sea, la transparencia de la marca no vive en
// estos masters, se genera aguas abajo. Por eso NO forzamos un alfa artificial.
//
// Recompresión: palette (cuantización a 128 colores; son gradientes navy→teal +
// monograma, tolera paleta sin artefactos visibles) + compressionLevel 9 +
// effort 10. Resultado: cada master ≤160 KB (objetivo ≤200-300 KB).
import sharp from "sharp";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const B = path.join(root, "public", "brand");
const kb = (bytes) => (bytes / 1024).toFixed(1);
const PALETTE_COLORS = 128; // suficiente para gradientes suaves + monograma

// [archivo, ancho máx destino]. Los cuadrados van a 768; el banner 16:9 a 1280.
const TARGETS = [
  ["aria-avatar.png", 768],
  ["aria-app-icon.png", 768],
  ["aria-banner.png", 1280],
  ["aria-lockup-vertical.png", 768],
  ["aria-favicon-solidA.png", 768],
  ["aria-lockup-horizontal.png", 768],
  ["aria-isotipo.png", 768],
];

async function main() {
  let totalBefore = 0;
  let totalAfter = 0;
  const rows = [];

  for (const [name, maxW] of TARGETS) {
    const file = path.join(B, name);
    const before = statSync(file).size;

    // Leemos el original a buffer para no leer/escribir el mismo path en vuelo.
    const inputBuf = readFileSync(file);
    const meta = await sharp(inputBuf).metadata();

    // Solo achicamos si el master es más ancho que el destino (withoutEnlargement).
    const outBuf = await sharp(inputBuf)
      .resize({ width: maxW, withoutEnlargement: true })
      .png({ compressionLevel: 9, effort: 10, palette: true, colors: PALETTE_COLORS })
      .toBuffer();

    // Verificación: el PNG recomprimido decodifica y tiene dimensiones válidas.
    // (No exigimos hasAlpha: el master es opaco y sharp descarta el alfa
    //  redundante; la transparencia la recrea gen-brand-assets aguas abajo.)
    const outMeta = await sharp(outBuf).metadata();
    const ok = outMeta.format === "png" && outMeta.width > 0 && outMeta.height > 0;
    if (!ok) throw new Error(`Verificación falló para ${name}: ${JSON.stringify(outMeta)}`);

    writeFileSync(file, outBuf);

    totalBefore += before;
    totalAfter += outBuf.length;
    rows.push({
      archivo: name,
      antes: kb(before) + " KB",
      despues: kb(outBuf.length) + " KB",
      dim: `${meta.width}x${meta.height} → ${outMeta.width}x${outMeta.height}`,
      alfa: outMeta.hasAlpha ? "sí" : "no (opaco)",
    });
  }

  console.table(rows);
  console.log(
    `Total: ${kb(totalBefore)} KB → ${kb(totalAfter)} KB ` +
      `(ahorro ${((totalBefore - totalAfter) / 1024 / 1024).toFixed(2)} MB)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
