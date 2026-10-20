# Comparador como domínio próprio (Tópico 24)

Comparação ≠ ranking ≠ recomendação ≠ filtro ≠ score. O comparador responde "como estes lotes se diferenciam entre si?"; ele não escolhe o "melhor lote".

## Módulos

| Arquivo | Global | Papel |
|---|---|---|
| `src/compare/comparisonDomain.js` | `App.compare.domain` | Sessão, política, contexto, registries, data provider, snapshot, matriz, store, seletores, serviço, persistência, deep link, share payload |
| `src/compare/criterionWinner.js` | `App.compare.evaluation`, `App.compare.viewModel` | Tópico 25 (vencedor por critério) e o ViewModel avaliado (texto pt-BR) |
| `src/presentation/compareView.js` | `App.compareView` | Render HTML puro do ViewModel + `handle`/`bind` para as ações da UI |
| `src/presentation/compare.css` | — | Estilos (tokens de `styles.css`, claro e escuro, alvos de 44 px no toque) |
| `config/compare/viva-juara.json` | `App.configs.compare['viva-juara']` | Política da comparação + registry de políticas de destaque (tópico 25) |
| `src/services/comparison.js` | `App.services.comparison` | API legada (`MAX_LOTS`, `compare`, `leaders`), agora delegando ao tópico 25 |

`scripts/configBundle.js` passou a empacotar `config/compare/` (mudança mínima: `'compare'` na lista de pastas).

## Fluxo

```
Lot (LotRepository.resolve) · CommercialState · AvailabilityState · LotAnalysisResult · FitScoreResult (Map) · RecommendationResult
                 │
                 ▼
     ComparisonDataProvider  (batch: 1 leitura de Lot por candidato; nada formatado, ranqueado ou recalculado)
                 │
                 ▼
 ComparisonMetricRegistry ─ Groups ─ MetricProfiles ─ ComparisonPolicy
                 │
                 ▼
  ComparisonSession (ids + ordem) ─► ComparisonSnapshot (valores + versões + hash) ─► ComparisonMatrix (sem vencedor)
                 │                                                                        │
                 ▼                                                                        ▼
  ComparisonStore / selectors / ComparisonService                    Tópico 25: ComparisonEvaluationSnapshot
                                                                                          │
                                                                                          ▼
                                                     EvaluatedComparisonViewModel (App.compare.viewModel.build)
                                                                                          │
                                                                    App.compareView.render (desktop = tablet = mobile)
```

## Inventário do comparador legado (fases 1–4)

- Candidatos: `ApplicationState.comparisonLotIds` (store.js), sanitizado contra os lotes carregados (`sanitize`, corta em 4) e serializado no hash `#<dev>.compare.<code>~<code>` (router). Continua sendo a fonte da lista; o domínio reconcilia com `syncFromIds` (mantém id da sessão, `addedAt`, ordem explícita).
- Tabela: `App.vm.comparisonVM` (viewmodels.js) monta linhas com `better: 'max'|'min'` e `App.services.comparison.compare` marcava o "melhor"; `overlays.compare` renderiza. Esse "max para notas e áreas, min para preço e distâncias" era o vencedor ad hoc proibido pelo tópico 25 — removido (ver `COMPARISON_WINNER_POLICIES.md`).
- Preferências do cliente: `App.explanation.compareMany` (tópico 16) continua sendo a fonte da tabela "Para o perfil do cliente"; o comparador não duplica essa lógica.

## Invariantes

- A sessão guarda `LotId` canônico (`VJ-QA-L0001`), nunca "327"; ordem em `candidateOrder`, nunca dependente da ordem de chaves.
- 2–4 lotes (`ComparisonPolicy`); 1 lote = `DRAFT`; o 5º devolve `COMPARISON_LIMIT_REACHED` e nada é removido.
- Mudança de status, filtro, camada, cliente ou perfil de métricas não remove candidatos.
- `null` nunca vira 0; `UNKNOWN` (incl. disponibilidade) nunca vira valor conhecido; `CONFLICTED` nunca é resolvido em silêncio; stale aparece como última informação.
- Nenhum score/Fit é recalculado (teste verifica que o módulo não chama o motor nem `lots.json`).
- Mesmo domínio e mesmo ViewModel em desktop/tablet/mobile (sem `MobileComparisonDomain`).
