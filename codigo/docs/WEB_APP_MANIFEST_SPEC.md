# Web App Manifest

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

Arquivo publicado: `manifest.webmanifest` (o `manifest.json` existente é o CacheManifest de **dados**, não confundir). Gerado por `src/pwa/webManifest.js` e validado no build (`scripts/pwaBuild.js` falha com manifest inseguro).

```json
{
 "id": "./",
 "name": "Plataforma de Inteligência Comercial",
 "short_name": "House 7",
 "description": "Mapa interativo de lotes com preço de tabela, análise, simulação e comparação. Funciona offline para empreendimentos preparados.",
 "lang": "pt-BR",
 "dir": "ltr",
 "start_url": "./",
 "scope": "./",
 "display": "standalone",
 "orientation": "any",
 "theme_color": "#2d6232",
 "background_color": "#f3f5f0",
 "categories": [
  "business",
  "productivity"
 ],
 "icons": [
  {
   "src": "icons/icon-192.png",
   "sizes": "192x192",
   "type": "image/png",
   "purpose": "any"
  },
  {
   "src": "icons/icon-512.png",
   "sizes": "512x512",
   "type": "image/png",
   "purpose": "any"
  },
  {
   "src": "icons/icon-maskable-512.png",
   "sizes": "512x512",
   "type": "image/png",
   "purpose": "maskable"
  }
 ],
 "prefer_related_applications": false,
 "shortcuts": []
}
```

## Regras
- `start_url`, `scope` e `id` são **relativos** ("./"): resolvem para a pasta da aplicação, restringindo o escopo (§22, §233). Sem query string, sem fragmento, sem token, tenant, cliente ou autenticação (§21). Validação: `validateWebManifest` (códigos UNSAFE_START_URL, SCOPE_TOO_WIDE, START_URL_OUT_OF_SCOPE…).
- `display: standalone`, `orientation: any`, cores do tema (#2d6232 / #f3f5f0).
- Ícones 192, 512 e maskable 512 (`src/pwa/icons`, copiados para `icons/`). Gerados a partir do logo Viva Juara — **decisão humana**: a marca do app instalado deve ser House 7 ou Viva Juara?
- Atalhos (§225/§226): nenhum hoje; nunca atalho para cliente específico.
- Branding por organização (§20): `buildWebManifest(branding)` aceita um OrganizationBranding; hoje House 7.
- A página leva `<link rel="manifest">`, `theme-color`, `apple-touch-icon` e `<meta name="app-build-id">` (build.js, via `headTags()`). O link precisa estar no `<head>`; o host do artefato deve manter os metadados no head.
