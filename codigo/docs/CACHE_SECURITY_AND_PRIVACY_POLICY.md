# Segurança e privacidade do cache (Tópico 48)

1. **Deny by default**: tipo sem política → NO_CACHE.
2. `securityClassOf(type)`: PUBLIC / TENANT / RESTRICTED / SENSITIVE. RESTRICTED e SENSITIVE **nunca** em disco (`validateRegistry`).
3. Nenhum token, header Authorization ou credencial é chave ou valor de cache; `makePartition` rejeita principalId com cara de token.
4. localStorage não é autorização; o cache nunca decide permissão — só guarda o que já foi autorizado.
5. Sem PII em chaves, URLs, logs, métricas ou mensagens de BroadcastChannel (só metadados whitelisted).
6. Purga em logout, troca de tenant, revogação de permissão/share e pedido de exclusão (LGPD).
7. SW ignora outras origens, `/api/`, Authorization, `no-store`/`private`.
8. Nada é enviado a terceiros.
