# Bootstrap do mapa e prontidão progressiva (Tópico 47)

`MapReadiness` (planner.js) é alimentado com o estado de cada recurso e expõe **níveis alcançados** (conjunto, não sequência rígida) e **capacidades**:

| Nível | Requer |
|---|---|
| `SHELL_READY` | APP_SHELL + DEVELOPMENT_CONFIG |
| `BASE_MAP_READY` | BASE_MAP_MEDIUM (planta) ou BASE_MAP_LOW — pode chegar depois da geometria |
| `GEOMETRY_READY` | shell + GEOMETRY_BUNDLE (lots.json) |
| `INTERACTIVE` | geometria (hit-test nativo do SVG, sem índice espacial a esperar) |
| `FULLY_ENHANCED` | interativo + preço resolvido (confirmado ou última tabela rotulada) + mapa base resolvido |

Capacidades: `CAN_PAN_ZOOM`, `CAN_SELECT_LOT`, `CAN_SEARCH_LOT`, `CAN_RENDER_DEFAULT_LAYER` (interativo); `CAN_SHOW_QUICKVIEW` (preço resolvido); `CAN_SHOW_AERIAL_HIGH_RES`; `CAN_SHOW_ADVANCED_LABELS`. Recursos com ERROR aparecem em `degraded`.

Disponibilidade não bloqueia nenhum nível: sem feed permanece "Status não confirmado". analysis-input.json e fotos são sob demanda.

`loadProgress()` separa bloqueantes de opcionais e nunca mostra um "100 %" enganoso.

## Mudança aplicada (offline.js)
Antes: `manifest → lots → commercial` em cascata (≈1,0 s + 1,1 s + 1,4 s no Playwright). Agora `remote.prefetch()` dispara lots e commercial **em paralelo** com o manifest na primeira visita; os checksums do manifest continuam sendo verificados antes de aceitar os dados. No boot, se a carga REMOTE tem < 30 s (`bootReuseMs`), está confirmada e as versões batem, o `SyncManager` reaproveita em vez de buscar de novo (eliminou a 2ª requisição de manifest/commercial).
