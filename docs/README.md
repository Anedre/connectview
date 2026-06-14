# Documentación — ARIA (Connectview)

> Plataforma de Contact Center / CRM **multi-tenant SaaS** sobre Amazon Connect.
> Cuenta AWS de la plataforma: `731736972577` (Novasys / ARIA) · Región base: `us-east-1`.

Esta carpeta es la **fuente de verdad** de la documentación. Está en Markdown para
poder versionarla junto al código y mantenerla en sync. El documento "bonito"
(portada, estilos, índice navegable) se arma a partir de estos `.md` en la
herramienta de ofimática / cowork al final.

## Cómo está organizada

La documentación se entrega en **3 pistas según audiencia**:

| Pista | Carpeta | Para quién | Tono |
|-------|---------|-----------|------|
| **Técnica (formal)** | [`tecnico/`](tecnico/) | Evaluador técnico / académico (UDEP) | Formal, justifica decisiones de diseño |
| **Comercial** | [`comercial/`](comercial/): [deck 16:9](comercial/aria-deck.pdf) · [one-pager](comercial/aria-one-pager.pdf) · [cómo funciona (simple)](comercial/como-funciona.md) · [arquitectura](comercial/arquitectura-comercial.md) | Cliente / dirección / ventas (no técnicos) | Beneficios, ROI, lenguaje simple |
| **Técnica interna** | [`interno/`](interno/) | Equipo de desarrollo / operaciones | Detalle real de despliegue y operación |

Los **5 entregables solicitados** viven en la pista técnica:

1. [Arquitectura de la aplicación](tecnico/01-arquitectura-aplicacion.md)
2. [Arquitectura física (despliegue AWS)](tecnico/02-arquitectura-fisica.md)
3. [Diagrama de flujo de procesos](tecnico/03-flujo-procesos.md)
4. [Manual de usuario e instalación](tecnico/04-manual-usuario-instalacion.md)
5. [Calculadora / análisis de costos](tecnico/05-costos.md) → hoja viva: [`costos/aria-costos.xlsx`](costos/)

## Diagramas

Todos los diagramas están en **Mermaid** (texto). Se renderizan automáticamente en:
GitHub, GitLab, VS Code (extensión *Markdown Preview Mermaid*), Notion, Obsidian.
Para exportarlos a PNG/SVG (p. ej. para pegarlos en el documento final):
[mermaid.live](https://mermaid.live) → pegar el bloque → *Export*.

## Convertir a Word / PDF / Google Docs

```bash
# Con pandoc (recomendado) — un documento por entregable:
pandoc tecnico/01-arquitectura-aplicacion.md -o 01-arquitectura.docx

# Todo el track técnico en un solo PDF:
pandoc tecnico/0*.md -o ARIA-Documentacion-Tecnica.pdf
```

> Nota: los bloques Mermaid se exportan como imagen con el filtro
> `mermaid-filter` de pandoc, o se reemplazan por el PNG exportado de mermaid.live.

## Estado

Documentación generada el **2026-06-04**, sobre el código real del repositorio
(76 funciones Lambda, 17 tablas DynamoDB, 68 endpoints HTTP verificados).
Los precios de la calculadora son de **junio 2026** y son **celdas editables**.
