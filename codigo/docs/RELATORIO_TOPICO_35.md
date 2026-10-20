# Relatório — Tópico 35: Versionamento analítico

## Resumo
`App.versioning` versiona e orquestra o IntelligenceEngine sem mudar nada do cálculo: AnalysisDefinition (LOT_INTELLIGENCE_BASE), snapshot de entrada só com dependências reais, grafo de módulos (DAG), chaves de computação por módulo e reuso, AnalysisRun ≠ AnalysisVersion, validação, publicação atômica com ponteiro e concorrência otimista, histórico de ativação, resolvedor CURRENT/LATEST/EXPLICIT/AS_OF, currentness seletiva, refresh plan, diff, impacto, reprodutibilidade honesta, determinismo, baseline legado e paridade (zero divergência nos 498 lotes), read model por modo e impressão digital de versões (metodologia, configs, planta, medições, tabela de preço, disponibilidade, engine).

## Pontos-chave
- Baseline legado: MIGRATED_LEGACY a partir de lots.json, reprodutibilidade PARTIAL (nunca FULL).
- Candidata COMPUTED: paridade exata em scores, classe, rankings, destaques, alertas e confiança; notas na precisão publicada (toleranceMatch). Ver ANALYSIS_PARITY_REPORT.md.
- LOT_INTELLIGENCE_BASE não lê preço nem disponibilidade (verificado sobre a config): mudança de tabela ou de disponibilidade mantém CURRENT_INPUTS. Uma definição que declarar preço passa a ser marcada (teste).
- Reuso: mudar só uma distância recalcula location e a jusante, reutiliza os outros 4 módulos base; o runner confere o checksum dos reutilizados.
- Modelo de lifecycle: status DRAFT/VALIDATED/PUBLISHED/ARCHIVED/REJECTED; CURRENT/SUPERSEDED derivados do ponteiro e das ativações.

## Arquivos
Criados: `src/versioning/analysisVersioning.js`, `config/versioning/viva-juara.json`, `tests/versioning.test.js`, docs ANALYTICAL_VERSIONING_ARCHITECTURE, ANALYSIS_RUN_AND_VERSION_MODEL, ANALYSIS_INPUT_SNAPSHOT_SPEC, ANALYSIS_MODULE_REUSE_AND_INVALIDATION, ANALYSIS_VALIDATION_AND_PUBLICATION_POLICY, ANALYSIS_REPRODUCIBILITY_POLICY, ANALYSIS_VERSION_DIFF_AND_IMPACT, ANALYSIS_LEGACY_MIGRATION_REPORT, ANALYSIS_PARITY_REPORT.
Alterados: `scripts/configBundle.js` (subpasta `versioning`, aditivo).

## Testes
`tests/versioning.test.js`: 16 testes (definição, grafo/ciclo, impressão digital, snapshot imutável e seletivo, run ≠ version, run falha, validação/publicação, publicação concorrente, relatório histórico + rollback, currentness, reuso de módulo, diff/impacto, reprodutibilidade/determinismo, paridade legada, tenant/read model, invariantes de score).

## Adiado / limitações
- Repositórios em memória; persistência Postgres, storage de artefatos e jobs em background: só contratos (sem acesso ao banco aqui).
- Recalcular só alguns lotes de um módulo: preparado (escopo por módulo), não executado — o engine roda o pipeline inteiro (~0,5 s).
- Integração com QuickView/Details/filtros/comparador/recommendation snapshots/provenance/confidence: `readModel` e `fingerprint` prontos para o integrador; não liguei a UI (não posso editar panels/app). Recommendation já guarda `analysisVersion` em sua chave (Tópico 15); passar a gravar o `versionId` é o próximo passo.
- Cache por versão e offline: o snapshot/versão são imutáveis (chave ideal de cache); nada novo foi gravado no service worker.

## Decisões humanas pendentes
Quem publica/reativa (`analysis.publish`, `analysis.activate`); publicar a candidata como versão atual; registrar commit/artefato e runtime no build para chegar a FULL; texto para cliente quando a análise estiver desatualizada.
