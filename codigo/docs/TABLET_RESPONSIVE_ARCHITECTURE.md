# Arquitetura responsiva do tablet (Tópico 23)

O tablet tem perfis próprios. Não é desktop estreito nem celular grande. O layout é escolhido pelo espaço que o workspace realmente tem e pelas formas de entrada, nunca pelo nome do aparelho ou pelo user-agent.

```
Viewport / container / orientação / pointer / hover
          │
   ResponsiveProfileResolver (src/layout/responsiveProfile.js)
          │  html[data-layout, data-lp, data-rp, data-hover, data-density]
          ▼
   TabletWorkspaceContainer = shell + controlador `layout` (app.js) + CSS por perfil
     ├── Mapa (sempre presente, nunca recriado na rotação)
     ├── Quick View: bottom sheet (retrato, compacto) ou painel lateral (paisagem, grande)
     ├── TabletOverlayCoordinator: um overlay grande por vez (filtros, camadas, legenda, ficha, comparação)
     ├── TabletMapViewportInsets + TabletMapCameraPolicy
     └── LotQuickViewCore (o mesmo componente de todos os tamanhos)
```

## O que mudou no código

- Antes, a folha de estilos tinha larguras fixas (`max-width:1023px`, `1024–1279px`, `min-width:1280px`) e o JavaScript usava `window.innerWidth < 1024`. Agora os 13 blocos de layout respondem ao perfil resolvido (`html[data-rp="sheet"]`, `html[data-rp="docked"]`, `html[data-lp="overlay"]`, `html[data-lp="docked"]`). Larguras ficaram só em ajustes cosméticos do cabeçalho.
- Não havia detecção de dispositivo por user-agent. Isso continua assim.
- `isSmall()` em `app.js` passou a significar "o painel do lote é um bottom sheet", decidido pelo perfil.
- O sheet do tablet tem alturas próprias (`TABLET_SNAP_CONFIG`): intermediário cerca de 36% e expandido cerca de 74%, menos agressivos que no celular.
- Ao mudar de perfil (rotação, split screen, janela redimensionada), `layout.onProfileChange()` converte o estado do Quick View de um container para o outro (`mapQuickViewStateAcrossLayouts`). Não mexe em lote, cliente, filtros, camada nem comparação, e não recalcula nada.
- Tooltips de hover só aparecem quando o aparelho tem hover. Nada essencial depende de hover.

Tópicos relacionados: [RESPONSIVE_PROFILE_RESOLVER.md](RESPONSIVE_PROFILE_RESOLVER.md), [TABLET_LAYOUT_PROFILES.md](TABLET_LAYOUT_PROFILES.md), [TABLET_ORIENTATION_STATE_MAPPING.md](TABLET_ORIENTATION_STATE_MAPPING.md), [TABLET_INPUT_CAPABILITIES.md](TABLET_INPUT_CAPABILITIES.md).
