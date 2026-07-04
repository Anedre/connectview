# ARIA — Brand assets

Fuente de verdad de los recursos de marca que **usa la app y el sitio** (favicon,
ícono de app, logo en UI, portadas). Los assets de marketing/comercial viven en
[`docs/comercial/img/`](../../docs/comercial/img/).

Marca: **ARIA · by Novasys** — contact center con IA.
Paleta: navy `#2C5698` → teal `#158A8C`, acento bronce `#B07D2B`, texto `#141C2B`.

---

## Archivos (déjalos con EXACTAMENTE estos nombres)

| Archivo                      | Qué es                                            | Dónde se usa                                    |
| ---------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `aria-isotipo.png`           | Símbolo solo (cinta "A"), navy sobre transparente | Logo en sidebar/topbar de la app                |
| `aria-isotipo-white.png`     | Símbolo solo en blanco                            | Fondos oscuros / dark mode                      |
| `aria-app-icon.png`          | 1024×1024, squircle navy→teal                     | PWA + apple-touch-icon                          |
| `aria-favicon.png`           | Versión simplificada 512×512                      | Pestaña del navegador                           |
| `aria-avatar.png`            | Símbolo blanco en círculo navy                    | Fotos de perfil (LinkedIn, WhatsApp, X)         |
| `aria-lockup-horizontal.png` | Símbolo + "ARIA / by Novasys" horizontal          | Login, emails, docs, firmas                     |
| `aria-lockup-vertical.png`   | Lockup apilado                                    | Espacios angostos, portadas                     |
| `aria-banner.png`            | 16:9 navy→teal con tagline                        | Portada LinkedIn, `og:image` (preview de links) |

> Ideal a futuro: versión **SVG** vectorial de `aria-isotipo` y `aria-favicon`
> (nítidos a cualquier tamaño, editables). Ver la oferta en el chat.

## Derivados web (generados) — NO editar a mano

Estos salen de los masters vía **`npm run brand:assets`** (`scripts/gen-brand-assets.mjs`, usa
`sharp`). Si cambiás un master, re-corré el script.

Los logos salen con **fondo transparente**: el script quita el blanco "quemado" por cobertura
(distancia a blanco) + un-premultiply, así los bordes quedan limpios sobre cualquier fondo.

| Salida                                                 | De                                              | Uso                                   |
| ------------------------------------------------------ | ----------------------------------------------- | ------------------------------------- |
| `brand/aria-mark.png` (160, navy, transp.)             | `aria-isotipo`                                  | Logo sobre fondos claros              |
| `brand/aria-mark-white.png` (160, blanco, transp.)     | `aria-isotipo`                                  | Sidebar/splash/login sobre navy·teal  |
| `brand/aria-lockup.png` (~720, transp.)                | `aria-lockup-horizontal`                        | Login/emails/firmas                   |
| `favicon-16/32/48.png` + `favicon.ico`                 | `aria-favicon-solidA` (A sólida, legible chico) | Pestaña                               |
| `apple-touch-icon.png` (180)                           | `aria-app-icon`                                 | iOS "Agregar a inicio"                |
| `icon-192/512.png` (any) + `icon-192/512-maskable.png` | `aria-app-icon` / marca                         | PWA (`site.webmanifest`) + notif. web |
| `og-image.jpg` (1200×630)                              | `aria-banner`                                   | `og:image` / preview de links         |

Cableado: `index.html` (favicons + `.ico` + apple-touch + `manifest` + `theme-color` + Open Graph/
Twitter), `public/site.webmanifest` (PWA any+maskable), `VoxSidebar` (logo), `App.tsx` (splash),
`VoxAuthContext` + `App.tsx` (login/gate), `useOmnichannelNotifier` (`/icon-192.png`).

## Estado

- [x] 7 PNG maestros colocados (2026-07-01) — hi-res 2048px, fondo blanco OPACO.
- [x] **Derivados web + transparencia + audit COMPLETO** (2026-07-04) — favicons legibles (solidA),
      apple-touch/PWA (any + maskable), `.ico`, `og:image`, marcas navy/blanca transparentes, lockup
      optimizado. Splash/login/sidebar a navy→teal. `favicon.svg`/`icons.svg` (rayo morado) borrados.
- [ ] Emails (`brandEmailHtml`) y XLSX navy: **falta redeploy** de `automation-engine`,
      `journey-runner`, `scheduled-export-runner`.
- [ ] `og:image`/`og:url` a URL **absoluta** cuando haya host de prod (hoy relativas).
- [ ] (Recomendado) Vectorizar isotipo + favicon a SVG (nítido a cualquier tamaño, editable).
