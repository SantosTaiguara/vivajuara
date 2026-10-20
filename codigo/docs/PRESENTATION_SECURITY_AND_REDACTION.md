# Segurança e Redação

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

- **Allow-list** de campos e blocos; o resto é negado.
- **scanPayload** em toda projeção e no snapshot; vazamento → preflight FAIL (não sobrescrevível).
- **CustomerDisplayPolicy**: primeiro nome por padrão; nunca contato, documento, orçamento implícito ou notas.
- **Sem IDs internos** na audiência; auditoria usa refs sanitizadas.
- **Permissões** (`domain.PERMISSIONS`): `presentation.read/create/update/archive/preview/snapshot.create/session.start/feedback.record` → chave interina `lot.view`; `presentation.internalNotes.read`, `presentation.preflight.override`, `presentation.theme.manage` → `null` (negadas localmente até existirem no registro do backend).
- **localStorage nunca autoriza**: `cache` só guarda refs não sensíveis; `OFFLINE_POLICY` não guarda snapshot nem rótulo de cliente.
- **CSS não é segurança**: as classes `ws.client`/`ws.pres` só escondem controles. O conteúdo seguro vem de `snapshot.audience`.
- **Wording**: sem "valorização garantida", "melhor investimento" etc. (`UNSAFE_CLAIM`).
- Limitação conhecida: o painel estático ainda carrega `lots.json` completo (dado público, sem PII). Para dados privados é necessário servir só o snapshot pelo backend.
