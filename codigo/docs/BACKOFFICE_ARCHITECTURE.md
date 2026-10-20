# BACKOFFICE_ARCHITECTURE — Arquitetura do backoffice

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

O backoffice é uma camada operacional sobre os serviços de domínio, não um CRUD de banco.

```
Console (App.backofficeView) → App.backoffice (navegação, inbox, filas, aprovações)
  → App.backoffice.commands (AdminCommandEnvelope: preview/execute)
  → POST /api/v1/admin/commands/{preview,execute}
  → createBackofficeService: tenant → autorização (iam) → política → DomainCommandHandler → auditoria → eventos
```

- **Shells separados:** o painel do corretor mostra no máximo `entryLink()` (vazio para o visitante público); o console é `shell()`.
- **Módulos:** `backofficeCore.js` (navegação, providers, inbox, filas, bulk, aprovações, atribuição), `backofficeCommands.js` (comandos seguros), `backofficeGovernance.js` (config versionada, flags, suporte, emergência, exportação, segredos, jobs, auditoria, busca), `backofficeView.js` (HTML).
- **Providers:** áreas de outros tópicos (deals=57, onboarding=58, privacy=59, dataquality=61) entram por `App.<nome>.backofficeAdapter` ou `registerProvider()`. Sem módulo → "Módulo não disponível"; módulo sem adapter → "ainda não integrado". O backoffice nunca importa esses arquivos.
- **Backend:** `backoffice.policy.js` (catálogo, mesma fonte do frontend), `backoffice.authz.js` (reusa `iam/authorization`), `backoffice.service.js`, `backoffice.repository.js` (memória + Postgres), `backoffice.controller.js`, `backoffice.openapi.js` (fragmento ainda não publicado).
- CQRS-lite: leituras são projeções; escritas são sempre comandos do domínio dono.
