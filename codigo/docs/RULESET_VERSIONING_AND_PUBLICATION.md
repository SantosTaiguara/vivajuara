# Versionamento e publicação de regras (Tópico 36)

`App.ruleEngine.ruleSetRegistry({ organizationId })` — TenantContext obrigatório; recursos de outro tenant são recusados.

- `addVersion` cria DRAFT (versões PUBLISHED só entram por importação do catálogo empacotado e já congeladas).
- `updateVersion` só em DRAFT; versão publicada é imutável (`PUBLISHED_IMMUTABLE` e objeto congelado). Mudar limite, lógica ou mensagem semântica = nova versão.
- `validateVersion` roda o validador; inválida vira REJECTED; válida vira VALIDATED com checksum e manifesto.
- `createRuleSetVersion` exige uma versão por regra (sem metade V1 / metade V2) e move apenas `latestRuleSetVersionId`.
- `publishRuleSet(id, { can, reason, expectedCurrentId, by, at })` exige `rule.publish`, motivo e o ponteiro esperado (`RULESET_CURRENT_VERSION_CONFLICT`); compila tudo antes de mudar qualquer coisa — publicação atômica.
- `rollback(id, …)` reativa um rule set publicado antigo; o novo fica como histórico; `requiresReevaluation: true` — os alertas são reavaliados, nunca restaurados.
- `currentCompiled()` serve só o rule set PUBLISHED atual; `compiledSet(id, { technical: true })` permite rascunho apenas em SHADOW/técnico.
- `activations()` / `asOf(at)` dão o histórico de ativação; `audit()` registra ator e motivo.
- `RuleSetImpactReport`: rodar o candidato em SHADOW e comparar com `App.alertMigration.parityReport` (mesma estrutura). Nenhuma regra é publicada automaticamente.
- Casos de teste de regra: `App.ruleEngine.runTestCases(compiled, cases)`.

Catálogo atual: `ruleset:viva-juara:legacy-v1` (14 regras, versão 1.0.0, publicado em 2026-10-06 como migração zero-delta).
