/**
 * reportExport — descarga de reportes como CSV o Excel (XLSX) del lado del cliente.
 * El XLSX usa exceljs cargado en forma LAZY (dynamic import) para no engordar el
 * bundle inicial: solo se baja cuando el usuario pide un Excel.
 */

export interface Column {
  key: string;
  label: string;
}

type Row = Record<string, unknown>;

const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(" | ");
  return String(v);
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Descarga las filas como CSV (BOM UTF-8 para que Excel abra bien los acentos). */
export function downloadCsv(filename: string, columns: Column[], rows: Row[]) {
  const esc = (v: unknown) => {
    const s = cellText(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${filename}.csv`);
}

/** Descarga las filas como XLSX real (exceljs, cargado lazy). */
export async function downloadXlsx(
  filename: string,
  sheetName: string,
  columns: Column[],
  rows: Row[],
) {
  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof import("exceljs") }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ARIA";
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || "Reporte");
  ws.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.min(46, Math.max(12, c.label.length + 4)),
  }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C5698" } };
  head.alignment = { vertical: "middle" };
  for (const r of rows) {
    const rec: Row = {};
    for (const c of columns) rec[c.key] = cellText(r[c.key]);
    ws.addRow(rec);
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${filename}.xlsx`,
  );
}
