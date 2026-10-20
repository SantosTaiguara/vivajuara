# Arquitetura do Modo de Apresentação

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

## Três conceitos separados
| Conceito | O que é | Mutável? | Módulo |
|---|---|---|---|
| **PresentationDefinition** | Roteiro editável: blocos, lotes, storyline, tema, cliente (ref) | Sim, com `revision` (conflito → `REVISION_CONFLICT`) | `App.presentationMode.domain.createDefinition/revise` |
| **PresentationSnapshot** | Conteúdo congelado e client-safe (`audience`) + refs internas (fora de `audience`) + `checksum` | Não (create-only, `deepFreeze`) | `domain.createSnapshot/verify` |
| **PresentationSession** | Estado de navegação (passo, modo, pausa, tela cheia, feedback) | Sim, mas nunca altera o snapshot | `App.presentationMode.runtime` |

## Camadas
1. `policy.js` — `ClientSafeProjectionPolicy` (allow-list, deny by default), `CustomerDisplayPolicy`, wording pt-BR, `scanPayload` (detector de vazamento).
2. `projection.js` — projeções client-safe por domínio (lote, preço, disponibilidade, recomendação, comparação, financeiro, mapa, objetivo do cliente, próximos passos).
3. `domain.js` — permissões, registro de blocos, templates, definição, preflight, snapshot, safety status, repositório em memória.
4. `runtime.js` — sessão, navegação, overlays, feedback, offline, tema/layout, restauração, exportação (pedido), inventário legado.
5. `presentationView.js` — markup (audiência, controles do apresentador, preflight, blocos). Sem lógica de dados.

## Fluxo
`sourcesFromRepo` → `createDefinition` / `fromRecommendation` / `fromFavorites` / `fromComparison` / `applyTemplate` → `preflight` (BLOCKING impede) → `createSnapshot` → `runtime.start` → `audienceView` → `App.presentationView.audience(...)`.

## Modos
- **SNAPSHOT** (padrão para cliente): conteúdo congelado com `preparedAt`; avisos de frescor.
- **LIVE** (`createLiveView`): reprojeta a partir das fontes atuais com a mesma política; nunca persiste.

## Invariantes
- A audiência só recebe `snapshot.audience`. Lote canônico, scores internos, provenance, IDs internos, notas e PII nunca entram.
- Preço exibido: somente **preço de tabela** (R$ 1.196/m², tabela 2026-10-06). Nenhuma promessa de valorização.
- Disponibilidade `UNKNOWN` → "Disponibilidade sujeita a confirmação" (nunca "Disponível").
- `null` nunca vira 0: aparece como "não disponível".
- O modo apresentação não altera perfil, favoritos, ranking nem jornada automaticamente (`end()` só *sugere* estágio, `autoApply:false`).

## Integração com o legado
`config/presentation.js` ganhou `clientDenyByDefault` + `clientSafeFields` (aditivo). O botão "Apresentar" atual continua funcionando; ver `PRESENTATION_LEGACY_MIGRATION_REPORT.md`.
