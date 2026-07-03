# ARIA — Brand assets

Fuente de verdad de los recursos de marca que **usa la app y el sitio** (favicon,
ícono de app, logo en UI, portadas). Los assets de marketing/comercial viven en
[`docs/comercial/img/`](../../docs/comercial/img/).

Marca: **ARIA · by Novasys** — contact center con IA.
Paleta: navy `#2C5698` → teal `#158A8C`, acento bronce `#B07D2B`, texto `#141C2B`.

---

## Archivos (déjalos con EXACTAMENTE estos nombres)

| Archivo | Qué es | Dónde se usa |
|---|---|---|
| `aria-isotipo.png` | Símbolo solo (cinta "A"), navy sobre transparente | Logo en sidebar/topbar de la app |
| `aria-isotipo-white.png` | Símbolo solo en blanco | Fondos oscuros / dark mode |
| `aria-app-icon.png` | 1024×1024, squircle navy→teal | PWA + apple-touch-icon |
| `aria-favicon.png` | Versión simplificada 512×512 | Pestaña del navegador |
| `aria-avatar.png` | Símbolo blanco en círculo navy | Fotos de perfil (LinkedIn, WhatsApp, X) |
| `aria-lockup-horizontal.png` | Símbolo + "ARIA / by Novasys" horizontal | Login, emails, docs, firmas |
| `aria-lockup-vertical.png` | Lockup apilado | Espacios angostos, portadas |
| `aria-banner.png` | 16:9 navy→teal con tagline | Portada LinkedIn, `og:image` (preview de links) |

> Ideal a futuro: versión **SVG** vectorial de `aria-isotipo` y `aria-favicon`
> (nítidos a cualquier tamaño, editables). Ver la oferta en el chat.

## Cómo se conectan al código
- **Favicon** → `index.html`: `<link rel="icon" href="/brand/aria-favicon.png">`
- **Ícono de app / PWA** → `manifest` con `aria-app-icon.png` (192 y 512) + `apple-touch-icon`
- **Logo en la app** → `<img src="/brand/aria-isotipo.png">` o import en React
- **Preview de links (redes/WhatsApp)** → meta `og:image` = `/brand/aria-banner.png`

## Estado
- [x] 7 PNG maestros colocados y renombrados (2026-07-01) — hi-res 2048px, ~2–4.5 MB c/u
- [ ] **Optimizar para web**: los PNG son masters pesados. Falta derivar versiones ligeras
      (isotipo transparente, `og:image` comprimido <300 KB) antes de usarlos en la app
- [ ] **Favicon real**: `aria-favicon-solidA.png` es el concepto "A sólida" (no combina con
      la cinta) y pesa 3.6 MB → rehacer como `favicon.svg` vectorial y conectar en `index.html`
- [ ] (Recomendado) Vectorizar isotipo + favicon a SVG (nítido a cualquier tamaño, editable)

> Nota: `aria-isotipo.png` tiene el fondo blanco "quemado" (no transparente). Para usarlo
> sobre superficies de color o en dark mode hace falta la versión transparente/SVG.
