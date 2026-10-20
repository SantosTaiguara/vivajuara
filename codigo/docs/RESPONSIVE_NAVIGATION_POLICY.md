# Política de navegação responsiva

## Colocação por perfil (NavigationPlacementResolver)
Resolvida pelo `ResponsiveProfile` (tópicos 22/23), nunca por user agent. Um registro, três contêineres (`html[data-nav=top|bottom|rail]`).
| Perfil | Colocação primária | Rótulos |
|---|---|---|
| MOBILE | BOTTOM_NAV | ícone + rótulo |
| TABLET_COMPACT | BOTTOM_NAV | ícone + rótulo |
| TABLET_PORTRAIT | BOTTOM_NAV | ícone + rótulo |
| TABLET_LANDSCAPE | TOP_NAV | ícone + rótulo |
| TABLET_LARGE | TOP_NAV | ícone + rótulo |
| DESKTOP | TOP_NAV | ícone + rótulo |

LEFT_RAIL está implementado (resolver + CSS) mas **desligado** (`density.railEnabled=false`): `layout/workspace.js` ainda não desconta a largura do trilho. Decisão D1.
No topo (desktop/tablet paisagem) os ícones aparecem só em desktop ≥ 1600 px (desktop amplo = ícone + rótulo; médio = compacto).

## Ferramentas do cabeçalho e overflow ("Mais")
| Ferramenta | MOBILE | TABLET_COMPACT | TABLET_PORTRAIT | TABLET_LANDSCAPE | TABLET_LARGE | DESKTOP |
|---|---|---|---|---|---|---|
| brand | INLINE | INLINE | INLINE | INLINE | INLINE | INLINE |
| development | INLINE | INLINE | INLINE | INLINE | INLINE | INLINE |
| search | INLINE | INLINE | INLINE | INLINE | INLINE | INLINE |
| access | OVERFLOW | OVERFLOW | OVERFLOW | OVERFLOW | OVERFLOW | OVERFLOW |
| sync | OVERFLOW | OVERFLOW | INLINE | OVERFLOW | INLINE | INLINE |
| customer | INLINE_WHEN_ACTIVE | INLINE_WHEN_ACTIVE | INLINE_WHEN_ACTIVE | INLINE_WHEN_ACTIVE | INLINE_WHEN_ACTIVE | INLINE_WHEN_ACTIVE |
| mode | OVERFLOW | INLINE | INLINE | INLINE | INLINE | INLINE |
| present | OVERFLOW | OVERFLOW | INLINE | INLINE | INLINE | INLINE |
| shortcuts | NONE | OVERFLOW | OVERFLOW | OVERFLOW | OVERFLOW | OVERFLOW |

INLINE_WHEN_ACTIVE = só aparece com cliente em atendimento (o chip não é item de navegação; Clientes está no menu). "Mais" existe por overflow real em tela compacta e para contexto do usuário/ajuda — não é depósito permanente de destinos.

## Celular: mapa ↓ sheet ↓ barra inferior
- Barra fixa de 58 px + `env(safe-area-inset-bottom)`; `.ws` ganha `padding-bottom` igual, então o corpo (mapa + sheet) termina acima da barra: a sheet nunca cobre a barra e a barra não cobre controles do mapa (zoom/legenda ficam dentro do corpo).
- A sheet minimizada não soma a área segura quando há barra inferior (a barra já a absorve).
- Na apresentação (`.ws.pres`) o cabeçalho e a barra somem; nenhuma navegação por swipe lateral.
- Rótulo curto "Empreend." só < 420 px (nome completo continua acessível).

## Medidas antes × depois (Playwright, chromium, claro e escuro)
| Viewport | Cabeçalho antes | Depois | Altura do mapa | Alcance |
|---|---|---|---|---|
| 320 × 640 (MOBILE) | 134 px (3 linhas: logo/seletor/modo · busca · 4 abas roláveis) | 95 px + barra inferior 58 px | 506 → 487 px | Técnico, Apresentar, chip de cliente, sincronização e contexto de acesso estavam ocultos por CSS; agora Técnico/Apresentar/sync/acesso no "Mais", chip quando há cliente |
| 390 × 844 (MOBILE) | 131 px (3 linhas) | 95 px + barra inferior 58 px | 713 → 691 px | idem |
| 768 × 1024 (TABLET_PORTRAIT) | 146 px (3 linhas) | 105 px + barra inferior 58 px | 878 → 861 px | chip de cliente e acesso estavam ocultos; agora chip quando há cliente, acesso no "Mais" |
| 1024 × 768 (TABLET_LANDSCAPE) | 105 px (2 linhas) | 105 px (2 linhas) | 663 → 663 px | sincronização passa ao "Mais"; Encontrar entra no menu |
| 1400 × 900 (DESKTOP) | 53 px | 55 px | 847 → 845 px | "Sem cliente" sai (Clientes está no menu); acesso (antes só ≥ 1440 px) no "Mais" |
Sem rolagem horizontal em nenhuma largura. Capturas: `scratchpad/t53/before_*.png`, `after_*.png`, `after_*_more.png`, `dark_*.png`, `func_390_*.png`.
