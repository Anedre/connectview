/**
 * zip — crea un archivo ZIP en memoria SIN dependencias. Usa el método STORED
 * (sin compresión): los archivos del paquete de metadata de Salesforce son
 * pequeños (unos KB de Apex/XML), así que comprimir no aporta y STORED evita
 * depender de una lib de ZIP para el contenedor. El Metadata API de SF acepta
 * ZIP STORED. CRC-32 estándar (polinomio reflejado 0xEDB88320).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Construye un ZIP (STORED) a partir de un mapa { ruta → contenido }. */
export function makeZip(files: Record<string, string | Buffer>): Buffer {
  const entries = Object.entries(files).map(([name, data]) => ({
    nameBuf: Buffer.from(name, "utf8"),
    data: Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"),
  }));

  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const crc = crc32(e.data);
    const size = e.data.length;

    // Local file header (30 bytes) + nombre + datos.
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // firma
    lfh.writeUInt16LE(20, 4); // versión necesaria
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(0, 8); // método = STORED
    lfh.writeUInt16LE(0, 10); // hora
    lfh.writeUInt16LE(0x21, 12); // fecha (1980-01-01, válida)
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18); // tamaño comprimido
    lfh.writeUInt32LE(size, 22); // tamaño real
    lfh.writeUInt16LE(e.nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra
    local.push(lfh, e.nameBuf, e.data);

    // Central directory record (46 bytes) + nombre.
    const cdr = Buffer.alloc(46);
    cdr.writeUInt32LE(0x02014b50, 0);
    cdr.writeUInt16LE(20, 4); // versión creadora
    cdr.writeUInt16LE(20, 6); // versión necesaria
    cdr.writeUInt16LE(0, 8);
    cdr.writeUInt16LE(0, 10);
    cdr.writeUInt16LE(0, 12);
    cdr.writeUInt16LE(0x21, 14);
    cdr.writeUInt32LE(crc, 16);
    cdr.writeUInt32LE(size, 20);
    cdr.writeUInt32LE(size, 24);
    cdr.writeUInt16LE(e.nameBuf.length, 28);
    cdr.writeUInt16LE(0, 30); // extra
    cdr.writeUInt16LE(0, 32); // comentario
    cdr.writeUInt16LE(0, 34); // disco
    cdr.writeUInt16LE(0, 36); // attrs internos
    cdr.writeUInt32LE(0, 38); // attrs externos
    cdr.writeUInt32LE(offset, 42); // offset del local header
    central.push(cdr, e.nameBuf);

    offset += lfh.length + e.nameBuf.length + e.data.length;
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // firma EOCD
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comentario

  return Buffer.concat([...local, cd, eocd]);
}
