# Runbooks de resposta a incidentes

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

Formato: **Detecção → Contenção → Erradicação → Recuperação → Pós-incidente**. Toda ação gera AuditEvent. A comunicação a clientes e à ANPD (LGPD) é decidida pelo responsável jurídico.

## 1. Tomada de conta (account takeover)
- Detecção: LOGIN_FAILURE em rajada, login de local novo, MFA_FAILURE.
- Contenção: revogar todas as sessões e refresh tokens do usuário e bloquear a conta.
- Erradicação: redefinir credencial e exigir MFA.
- Recuperação: revisar ações de alto risco feitas no período.
- Pós-incidente: ajustar `auth.login`.

## 2. Token vazado (sessão/admin/dev)
- Revogar o token (ADMIN_API_TOKEN: rotacionar no ambiente e reiniciar).
- Buscar uso por `requestId`/hash de IP.
- Confirmar que produção recusa dev tokens.

## 3. Segredo vazado (SECRET_LEAK_DETECTED)
- Rotacionar imediatamente (`SECRET_ROTATION`) e invalidar o valor antigo.
- Remover do histórico (o valor continua comprometido mesmo após a remoção).
- Rodar `securityScan.js` em todo o repositório.

## 4. Exposição entre tenants (TENANT_SCOPE_VIOLATION)
- Desligar a rota afetada.
- Identificar os registros expostos a partir dos logs de acesso.
- Corrigir o escopo no repositório (sempre `organization_id` vindo do contexto autenticado).
- Notificar a organização afetada. Avaliar RLS (D50-7).

## 5. Upload malicioso
- Manter em quarentena e bloquear o download.
- Verificar quem baixou.
- Revisar `uploadPolicy.json`. O scanner de malware é a decisão D50-6.

## 6. Mudança de preço não autorizada
- Congelar publicação/ativação.
- Restaurar a tabela vigente (R$ 1.196/m², 2026-10-06) a partir do histórico.
- Revisar a dupla aprovação de `PRICING_PUBLISH`/`PRICING_ACTIVATE`.

## 7. Override de disponibilidade não autorizado
- Reverter para o último estado com proveniência (UNKNOWN se não houver confirmação; UNKNOWN nunca vira AVAILABLE).
- Auditar `AVAILABILITY_OVERRIDE`.

## 8. Vazamento de link de compartilhamento
- `share.revoke` no servidor.
- Conferir `share.validate.token`.
- Emitir novo link só para os destinatários legítimos.

## 9. Comprometimento de dependência
- Fixar a versão anterior e reinstalar com `npm ci`.
- Rotacionar os segredos acessíveis pelo processo.
- Rebuild e redeploy; revisar `dependencyInventory`.

## 10. XSS / CSP_VIOLATION
- Identificar o campo e o caminho.
- Aplicar escape na view (padrão: patch P1).
- Pedir aos usuários afetados que limpem o estado local. O scrub da restauração já neutraliza valores malformados.
