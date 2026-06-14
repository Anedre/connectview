#!/usr/bin/env node
/**
 * _dumpserver.mjs — servidor local efímero (puerto 9999) que recibe el
 * localStorage del navegador logueado del usuario y lo guarda en
 * infra/_session.json. Privacidad: los tokens van navegador→archivo, NUNCA
 * pasan por el chat. One-shot: se apaga apenas recibe la sesión.
 *
 * Uso: node scripts/_dumpserver.mjs
 * Luego, en la consola del navegador (en http://localhost:5173, ya logueado):
 *   fetch('http://localhost:9999', { method:'POST', body: JSON.stringify(localStorage) })
 */
import { createServer } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "infra", "_session.json");
mkdirSync(dirname(OUT), { recursive: true });

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const obj = JSON.parse(body); // validar
        writeFileSync(OUT, body, "utf8");
        console.log(`✅ sesión guardada: ${OUT} (${Object.keys(obj).length} claves, ${body.length} bytes)`);
        res.writeHead(200); res.end("ok");
        server.close(() => process.exit(0)); // one-shot
      } catch {
        res.writeHead(400); res.end("bad json");
      }
    });
    return;
  }
  res.writeHead(200); res.end("dumpserver listo — POST tu localStorage");
});
server.listen(9999, () => console.log("🟢 dump-server en http://localhost:9999 (esperando POST)…"));
setTimeout(() => { console.log("⏰ timeout (15 min) — nada recibido"); process.exit(1); }, 900_000);
