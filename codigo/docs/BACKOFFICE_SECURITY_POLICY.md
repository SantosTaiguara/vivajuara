# BACKOFFICE_SECURITY_POLICY — Política de segurança do backoffice

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

- Deny by default em todas as camadas; o visitante público não vê nada do console.
- Nenhum papel recebe permissão `backoffice.*` (frontend e backend: `roleGrants = {}`) até decisão humana.
- Step-up: não há MFA ainda → toda ação com step-up fica bloqueada (`STEP_UP_REQUIRED`).
- CSRF nas escritas por cookie; respostas `private, no-store`; rate limit admin do app.
- Sem segredos exibidos; sem PII em URL, log ou métricas; busca sensível por POST e sem histórico.
- Busca e comandos entre organizações bloqueados (404, sem revelar existência).
- Escrita administrativa offline proibida.
