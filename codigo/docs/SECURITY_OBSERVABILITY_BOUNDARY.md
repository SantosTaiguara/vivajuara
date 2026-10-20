# Fronteira entre observabilidade e segurança

- SecurityEvent (tópico 50, `App.authz.securityEvent`) continua sendo a fonte. A observabilidade **não cria** SecurityEvent nem Audit (teste `separation`).
- Só contagens agregadas por categoria entram em métricas: `authorization_denied_total{permission_group}` (primeiro segmento da permissão, ex.: `pricing`), `tenant_scope_violation_total`, `tenant_context_missing_total`, `share_access_denied_total{reason_category}`. Sem userId, sem token, sem organização como label.
- `signals.fromSecurityEvents(events)` agrega por tipo; nunca copia ator, dados ou token.
- `tenant_scope_violation` é CRITICAL, dono `seguranca`, runbook RB-TENANT-SCOPE e política `NEVER_AUTO_SILENCE` (validado no CI do registro).
- Esses contadores devem ficar em zero ou quase zero.
- Logs de segurança, contexto restrito de cliente e logs de acesso ao backend de observabilidade ficam com o time de segurança (RBAC separado, decisão O8).
- Backend de observabilidade (quando existir, O1): SSO, MFA, RBAC, menor privilégio, retenção e log de acesso; logs nunca públicos.
- Pedir ao usuário um print do console é proibido no runbook de suporte: use o botão "Copiar diagnóstico técnico".
