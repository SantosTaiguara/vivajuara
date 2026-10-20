# Segurança e privacidade da decisão

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

- Classificação: DecisionSession CONFIDENTIAL; notas e orçamento RESTRICTED (política).
- Permissões: `decision.read`, `decision.create`, `decision.update`, `decision.override`, `decision.share`. Negadas por padrão. `ctx.can` (decisão do servidor) prevalece; no modo aparelho (sem login) valem leitura, criação, edição e curadoria locais em memória; compartilhar exige servidor (negado). As chaves ainda não estão em `config/security/permissions.json` (decisão de papéis em aberto).
- Sem PII no contexto: só id opaco do cliente; nome e contato nunca entram. E-mail ou telefone como id é recusado.
- Nada em URL, localStorage ou IndexedDB. Repositório só em memória (`persistent: false`). `security.persistOffline: false`.
- Histórico e auditoria descartam nota, nome, orçamento, telefone e e-mail.
- Projeção do cliente (`clientSafe`): sem score, sem códigos internos, sem nota, sem orçamento; passa pelo `scanPayload` da apresentação (0 problemas nos testes).
- Nenhum impulso comercial oculto: rank continua só do perfil e do contexto.
