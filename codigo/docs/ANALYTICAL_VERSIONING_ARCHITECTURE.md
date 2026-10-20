# Arquitetura de versionamento analítico (Tópico 35)

```text
ANALYSIS RESULT = INPUT SNAPSHOT + ANALYSIS DEFINITION + METHODOLOGY VERSION(S)
                + MODULE VERSION(S) + ENGINE BUILD + CONFIG VERSION(S) + EXECUTION
```

Módulo: `src/versioning/analysisVersioning.js` (`App.versioning`); configuração: `config/versioning/<dev>.json` (AnalysisDefinition, política de publicação, perfil de precisão). O IntelligenceEngine não foi reescrito: o versionamento só o orquestra e registra; nenhum score, classe, ranking, alerta ou preço muda (teste de invariantes).

```text
inputSnapshot(def, fontes) ─► repository.plan() ─► repository.run() ─► AnalysisRun + AnalysisVersion DRAFT
        (só dependências reais)   (REUSE/RECOMPUTE)   (executa o engine,      │
                                                         nunca publica)       ▼
                                             validate() → VALIDATED (imutável) / REJECTED
                                                              │
                                     decision() / publish(expectedCurrentVersionId) → ponteiro + evento de ativação
                                                              │
                                 resolve(CURRENT_PUBLISHED | LATEST | EXPLICIT_VERSION | AS_OF), activate() (rollback)
                                                              │
                         currentness() / refreshPlan() / diff() / impact() / reproducibility() / readModel()
```

Repositório em memória, isolado por tenant (`repository({ organizationId })`): versões, runs, snapshots, module result sets, result sets, relatórios de validação, ponteiros, ativações, auditoria e eventos (só ids e refs). O backend (Postgres) recebe os mesmos contratos — DTOs neste documento e em ANALYSIS_RUN_AND_VERSION_MODEL.md; nenhum código de banco foi escrito (sem acesso ao banco aqui).

`App.versioning.fingerprint({ dev, methodologyConfig, inputDoc, dataVersions, availabilityRevision })` dá a impressão digital de tudo que a plataforma serve agora (metodologia com checksum, configs empacotadas, planta, medições com sha256, tabela de preço 2026-10-06 a R$ 1.196/m², revisão de disponibilidade, engine e versões de módulo) — leitura apenas.

Definição registrada: **LOT_INTELLIGENCE_BASE** (scores, notas, níveis, classe, rankings, destaques, perfis, alertas legados, confiança). DATA_CONFIDENCE e outras definições não existem no produto atual e não foram inventadas; os alertas viram produto próprio no Tópico 36 (RuleSet), não uma AnalysisVersion.
