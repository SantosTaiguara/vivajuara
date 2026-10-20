# Política de rollback

## Níveis

| Nível | Mecanismo | Uso |
|---|---|---|
| 1 — UI | feature flag (`features.*`) desliga o caminho novo | padrão para toda capacidade em SHADOW, CANARY ou NEW_WITH_FALLBACK |
| 2 — Aplicação | republicar o artefato anterior (build de arquivo único versionado) | regressão sem flag |
| 3 — Dados | evitado; usar expand/contract e rollforward | mudança de schema |

## Versões imutáveis

Dataset (`2026-10-06.1`), tabela de preço (2026-10-06), análise e metodologia são publicadas e imutáveis. Rollback é mover o ponteiro "atual" (ex.: A16 → A15) sem apagar a versão nova.

## Por domínio

- **Preço:** reativar a versão anterior da tabela, conforme a política, com registro. Nunca editar a versão publicada.
- **Disponibilidade:** não existe "rollback" arbitrário de status. A correção é uma nova transição ou compensação formal, com autor e motivo.
- **Cliente/Jornada:** o histórico não é apagado para fazer rollback. A correção é um novo evento.
- **Golden:** recapturar (`node scripts/goldenBaseline.js --update`) só com exceção registrada em `LEGACY_PARITY_EXCEPTIONS.md`.

## Regra

Dados mutáveis preferem rollforward: uma nova migration ou transição. Toda fase de `roadmap.json` traz `rollbackStrategy`.
