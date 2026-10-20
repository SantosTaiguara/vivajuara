# Relatório — Tópico 60: Backoffice operacional e console administrativo

Data: 17/10/2026. O painel publicado não muda para o visitante: nenhum módulo novo entra no ORDER/build até o integrador ligar, e o visitante público não vê nenhuma entrada do console.

## O que foi feito
- **Console (frontend):** shell administrativo separado do painel do corretor. A navegação vem das permissões e nega por padrão. Inclui caixa operacional, 13 filas de trabalho, Approval Center, política de ações em massa, atribuição e reserva de trabalho, comandos seguros (envelope, prévia, execução, revisão, motivo, step-up, segunda aprovação), tela de conflito, configuração versionada com diff, governança de flags, sessão de suporte com banner, controles de emergência, exportação com prévia e CSV seguro, status de segredos, regras de jobs, visualizador de auditoria e busca com escopo.
- **Servidor:** módulo `backoffice` com o mesmo pipeline de comandos. Reaproveita a autenticação e a autorização do `iam` e tem tokens de prévia HMAC, idempotência, auditoria minimizada e handlers próprios (atribuição, config publish/rollback, sessão de suporte, emergência). Tem repositório em memória e em Postgres e a migração 014 com o script de reversão.
- **Integração com outros tópicos (57/58/59/61):** feita por adapters. Se o módulo não existe, a área mostra "Módulo não disponível".

## Matriz de propriedade, aprovação e filas
Ainda não há inventário real das operações manuais: quem muda preço, quem confirma disponibilidade, quem aprova desconto e quem cria usuário. Isso precisa de uma conversa com a operação. As filas estão em `backofficeConfig.workQueues`. As ações e suas políticas estão em `backofficeConfig.actions`, com 30 códigos.

## Arquivos
Criados:
- `src/config/backoffice/backofficeConfig.js` e `src/backoffice/{backofficeCore,backofficeCommands,backofficeGovernance,backofficeView}.js`
- `tests/backoffice.test.js`
- `backend/src/modules/backoffice/{backoffice.policy,backoffice.authz,backoffice.service,backoffice.repository,backoffice.controller,backoffice.openapi}.js`
- `backend/tests/backoffice.test.js`
- `backend/migrations/014_backoffice_admin.sql` e `down/014_backoffice_admin.down.sql`
- os 26 documentos da §587 e este relatório

Alterados (só adições): `config/security/permissions.json` (26 chaves `backoffice.*`, nenhuma concedida a papel) e `docs/PERMISSION_REGISTRY.md`.

## Adiado (com motivo)
- **Rotas fora do `app.js` e do OpenAPI.** O teste de contrato exige que as rotas documentadas sejam iguais às registradas. As chaves `backoffice.*` também não estão no registro IAM do backend, porque entrar lá concede tudo ao OWNER_ADMIN automaticamente. A receita está em `backoffice.openapi.js`.
- **Handlers de domínio de outros tópicos** (reserva, venda, preço, privacidade, publicação, conflito): os módulos donos registram os seus.
- **Partes sem banco ou sem navegador:** o Postgres do repositório não foi testado (falta a senha). Não há E2E no navegador. O step-up/MFA ainda não existe.
- **Dashboards e funções extras:** dashboards, virtualização de tabelas, paleta de comandos e visões salvas.

## Riscos não resolvidos
- Enquanto as políticas estiverem `null`, várias ações ficam bloqueadas (fail closed).
- O controle no frontend é só experiência de uso: o servidor é a autoridade.

## Decisões de negócio necessárias
- Quais papéis recebem `backoffice.*`.
- Separação de funções (hoje tratada como sim).
- Limite das ações em massa.
- Prazos das filas (SLA) e calendário de dias úteis.
- Duração e aprovação da sessão de suporte.
- Duração máxima de um controle de emergência.
- Validade do link de exportação.
- Antecedência do aviso de sunset das flags.

## Decisões de segurança necessárias
- Mecanismo de step-up/MFA.
- Timeout de inatividade do console.
- Chave e validade da prévia (técnica: 300 s; a chave pode ser derivada de SESSION_SECRET?).
- Registrar as chaves no IAM do backend.
- Novo código de erro `ADMIN_COMMAND_REJECTED` (422) no catálogo.

## Testes
- Frontend: 15 testes em `tests/backoffice.test.js`.
- Backend: 11 testes em `backend/tests/backoffice.test.js`, sem banco.

Isto não é aconselhamento jurídico.
