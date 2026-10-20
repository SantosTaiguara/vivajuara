# Relatório — Tópico 37: estados de dados desconhecidos e degradação elegante

## Entregue
- `src/datastate/dataState.js` (`App.dataState`): CanonicalDataState, ProjectedDataState, FreshnessState, DataCompletenessState, DataAccessProjection, UiLoadState,
  RawDataPresenceState, FilterEvaluation/FilterUnknownPolicy, UnknownSortPolicy, ConstraintStatus; DataStateReasonRegistry (17 códigos, alinhamento 1:1 com NotAvailableReason do 33);
  FieldDataStatePolicy derivada do Field Registry + refs; DataStatePolicyValidator; NullNormalizationPolicy legada + observeRaw/normalizeObservation;
  AttributeDataStateRecord, AttributeDataStateIndex (tenant-scoped, eventos de transição); DataStateInvariantValidator; adaptadores Pricing e Availability;
  DataStateResolutionService/AttributeValueResolver (`resolve`, `resolveMany`, `canonicalStateOf`); display projection pt-BR por modo; derive (DerivedStatePolicy);
  filtros/facetas, restrições, operando de regra, ordenação sem sentinela, comparabilidade, compartilhamento, exportação, DTO, estilo de mapa sem dado, legenda, cache key;
  diagnostics, coverage, legacyNullInventory, parity, impactReport.
- `src/presentation/favoritesView.js` → `dataValue(label, resolved)`; estilos `ds-*` em `favorites.css`.
- Docs: GRACEFUL_UNKNOWN_DATA_STATES, ATTRIBUTE_DATA_STATE_MODEL, NULL_AND_SENTINEL_NORMALIZATION_POLICY, DATA_STATE_UI_PROJECTION_POLICY,
  DATA_STATE_FILTER_COMPARE_SHARE_SEMANTICS, LEGACY_NULL_MIGRATION_REPORT, DATA_STATE_IMPACT_REPORT, DATA_STATE_TEST_MATRIX.
- Testes: `tests/datastate.test.js` (26), todos os 19 cenários dourados.

## Inventário (resumo)
33 campos anuláveis sempre nulos; 4 sentinelas de enum UNKNOWN + 1 sentinela textual (`fech`, 30); zeros em 7 campos; 4 coleções vazias conhecidas.
Paridade: 49.830 valores KNOWN idênticos ao Lot (0 divergências). 15 mapeamentos aguardam revisão humana (LEGACY_NULL_MIGRATION_REPORT).
Padrões de truthiness: `compareView.js:60 v || '—'` (0 viraria "—") — relatado, não corrigido. Formatadores devolvem "Não disponível" genérico.

## Não alterado
Availability, Pricing (R$ 1.196/m², tabela 2026-10-06), scores, Fit, Recommendation, vencedor, metodologia, IDs. Nenhum cálculo muda.

## Adiado / limitações
- Integração na UI (Quick View, Full Details, comparação, mapa, legenda, filtros) — o resolver está pronto; a troca dos formatadores é do lead.
- Rule Engine (36), Confidence (34) e Provenance formal (33) não existem no código: só os pontos de integração (`toRuleOperand`, `provenanceSummary`).
- Backend: tabela `attribute_data_states` e DTOs como contrato; nada em Postgres.
- Política de acesso real vem da camada de segurança (`opts.access`); o padrão só oculta notas/fonte/proposta/revisão no modo cliente.

## Decisões humanas
1. Confirmar classificações MEDIUM (topografia, declividade, drenagem, ventilação, nome de rua) e as UNKNOWN/LEGACY_UNCLASSIFIED.
2. Zeros geométricos (5 lotes) — dado real ou erro de vetorização?
3. Corrigir `compareView.js` (`v || '—'`) como bugfix?
4. Preço sem tabela: NOT_AVAILABLE "sob consulta" vs UNKNOWN; política de compartilhamento de campos críticos (ressalva vs bloqueio).
