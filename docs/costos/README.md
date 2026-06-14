# Calculadora de costos — `aria-costos.xlsx`

Hoja de cálculo **con fórmulas vivas**: editás los parámetros y recalcula sola.

## Hojas
| Hoja | Contenido |
|------|-----------|
| **Léeme** | Instrucciones. |
| **Parametros** | Volúmenes de uso por escenario (Piloto / Pyme / Enterprise). **Editable.** |
| **Precios** | Precios unitarios AWS/Meta + licencia externa (Salesforce) + supuestos. **Editable.** |
| **CostoCliente** | Lo que paga el **cliente** en su cuenta AWS (BYO). La licencia Salesforce va **aparte** (externa, fuera del TOTAL AWS). Fórmulas. |
| **CostoARIA** | Lo que paga la **plataforma** (ARIA) por operar. Fórmulas. |
| **Resumen** | Totales, costo por agente, opex y tarifa editables, **margen bruto** (incl. opex) vs **contribución** (solo infra). |
| **PrecioARIA** | **¿Cuánto cobrar?** Costo-plus vs. valor vs. servicio + precio recomendado/agente + **sección D: cobertura si ARIA hospeda la instancia (NO-BYO)**. **Editable.** |

## Uso
1. Abrir en Excel / Google Sheets / LibreOffice.
2. Editar `Parametros` (y `Precios` si cambian las tarifas).
3. Leer `Resumen`.

## Regenerar desde el modelo
```bash
node scripts/gen-costos-xlsx.mjs
```
> Fuente del modelo: [`scripts/gen-costos-xlsx.mjs`](../../scripts/gen-costos-xlsx.mjs).
> Explicación narrativa: [`../tecnico/05-costos.md`](../tecnico/05-costos.md).

Precios: us-east-1, junio 2026, **verificados vs AWS Price List API** (auditoría
v3, 2026-06-07). Quedan a confirmar por país: telefonía Perú, Meta WhatsApp y el
posible solapamiento WBM/EUM Social. Todas las celdas son **editables**.
