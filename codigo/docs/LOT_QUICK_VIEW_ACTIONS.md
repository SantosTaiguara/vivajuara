# Lot Quick View: ações

Tópico 20. Modelo de ações em `plat/src/quickview/quickview.js` (`actions`, `capabilities`), ordem em `actionOrder` de `plat/config/quickview/viva-juara.json`, botões em `plat/src/presentation/panels.js` (`ACT`, `actionButton`, `quick`) e efeitos em `plat/src/presentation/app.js` (delegação de `click` por `data-act`). As regras de status vêm de `plat/src/domain/availability.js` (`primaryAction`, `simulationEligibility`).

## 1. QuickViewAction

```
{ id, labelKey, iconToken, priority, visible, enabled, disabledReasonKey, loading, destructive, analyticsKey, actionCode?, pressed? }
```

`priority` é a posição numérica na lista (0 a 11); `loading` e `destructive` são sempre `false`; `analyticsKey` = `quickview_<id>`; `disabledReasonKey` só existe quando a ação está desabilitada. Só as ações visíveis entram na lista, ordenada por `actionOrder`: primary, details, compare, simulate, share, favorite, solar, routeGate, routeLeisure, explain, copyId, provenance.

## 2. Ação principal pelo status

`AV.primaryAction(status)`:

| Status | Ação | Rótulo | Efeito (`data-act="primary"`) |
|---|---|---|---|
| `AVAILABLE` | `SIMULATE` | Simular compra | abre o painel de simulação |
| `UNKNOWN` | `CONFIRM_AVAILABILITY` | Confirmar disponibilidade | popover `confirmInfo` |
| demais | `DETAILS` | Ver detalhes | abre os detalhes |

Popover "Confirmar disponibilidade": no corretor, "Este lote ainda não tem status confirmado pelo espelho de vendas. Confirme com a loteadora antes de oferecer; o aplicativo não reserva lotes."; no cliente, "A disponibilidade deste lote será confirmada pelo corretor." Ambos com o botão "Simular mesmo assim". Hoje todos os 498 lotes caem neste caso.

A ação principal é o único botão com destaque (`btn pri wide`, ocupa as duas colunas da grade `.acts`); as demais são botões comuns.

## 3. Catálogo

| id | Rótulo | Visível quando | Habilitada quando | Motivo se desabilitada | Efeito |
|---|---|---|---|---|---|
| `primary` | conforme o status | sempre | sempre | — | seção 2 |
| `details` | Ver detalhes | sempre | sempre | — | `panel=details` |
| `compare` | Comparar / Na comparação | sempre | há vaga (máximo 4) ou o lote já está na comparação | "Até 4 lotes na comparação." | `toggleCompare`; `aria-pressed` |
| `simulate` | Simular | a ação principal não é simular | `simulationEligibility(...).allowed` | aviso da elegibilidade | `panel=simulation` |
| `share` | Compartilhar | sempre | sempre | — | `openShare([lote])` |
| `favorite` | Favoritar / Favorito | sempre | sempre | — | `toggleFav`; `aria-pressed` |
| `solar` | Sol no lote | `features.solarAnalysis` | idem | — | `panel=solar` |
| `routeGate` | Rota à portaria | contexto diferente de `PRESENTATION` | sempre | — | `showRoute=gate` (de novo desliga); `aria-pressed` |
| `routeLeisure` | Rota ao clube | contexto diferente de `PRESENTATION` | sempre | — | `showRoute=leisure` |
| `explain` | Por que esta posição? | fora do modo cliente e lote no resultado da recomendação | fora do modo cliente e com Fit | "Selecione um cliente." | popover de explicação (tópico 16) |
| `copyId` | Copiar ID técnico | modo técnico | sempre | — | copia o id canônico ("ID copiado.") |
| `provenance` | Origem dos dados | modo técnico | sempre | — | popover de proveniência de `availability.status` |

Ação desabilitada continua visível com `disabled` e o motivo em `title`, para explicar a capacidade (ex.: comparação cheia). Com a política do Viva Juara (`simulateNonOfferable = true`), simular é permitido para qualquer status como consulta: em `UNKNOWN` com o aviso "Disponibilidade sujeita a confirmação"; nos outros status não ofertáveis, "Simulação apenas consultiva: o lote não está disponível". Por isso `simulate` não aparece desabilitada hoje.

Fora da lista de ações, o bloco de compatibilidade tem o atalho "Por quê?" (`data-act="explain"`) quando há recomendação e o modo não é cliente, e o botão "Mais <n> pontos nos detalhes" abre a seção Inteligência dos detalhes.

## 4. Capacidades

`capabilities(ctx, lot, input)`:

| Capacidade | Regra |
|---|---|
| `canViewCommercial` | sempre `true` |
| `canViewTechnical` | fora do modo cliente |
| `canShare`, `canFavorite` | sempre `true` |
| `canSimulate`, `simulateReason` | `simulationEligibility(status, policyOf(dev))` |
| `canCompare` | menos de `MAX_LOTS` (4) na comparação, ou o lote já está nela |
| `canSolar` | `dev.features.solarAnalysis` (Viva Juara: `true`) |
| `canExplain` | fora do modo cliente e com `FitScoreResult` |

Não há lógica de autenticação ou papel embutida; papéis ficam para um tópico posterior.

## 5. Ações por modo e contexto

Contagem real para o B79 (sem cliente, salvo indicação):

| Modo / contexto | Ações visíveis |
|---|---|
| cliente | primary, details, compare, simulate, share, favorite, solar, routeGate, routeLeisure (9) |
| corretor | as mesmas 9 |
| corretor, lote no resultado da recomendação | as 9 + explain (10) |
| técnico | as 9 + copyId, provenance (11) |
| apresentação (`presentation: true` no modo cliente) | primary, details, compare, simulate, share, favorite, solar (7) |

## 6. Controles do contêiner

Não fazem parte do modelo de ações: "Fechar lote" (`closeLot`, limpa a seleção), "Voltar ao resumo" nos outros painéis e, abaixo de 1024 px, "Recolher" e "Expandir" do bottom sheet (`sheetDown`/`sheetUp`, desabilitados nos extremos). Ver `MOBILE_BOTTOM_SHEET_ARCHITECTURE.md`.

## 7. Não implementado / pendências

- Implementado em 08/10/2026: a primeira ação visível é `PRIMARY`, as duas seguintes `SECONDARY` e as demais ficam no menu "Mais ações" (`OVERFLOW`). O nível `TERTIARY` não é usado.
- `loading` e `destructive` nunca mudam; nenhuma ação mostra carregamento.
- Implementado em 08/10/2026: cada ação registra `quick_action` com a chave e o nível. A telemetria continua só em memória (`App.analytics`).
- Ação "Origem dos dados" sempre abre a proveniência do status, não de um campo escolhido.
- Resumo para o cliente pelo corretor ("share client summary") é o mesmo compartilhamento comum.
