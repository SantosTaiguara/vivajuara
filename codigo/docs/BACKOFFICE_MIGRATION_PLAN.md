# BACKOFFICE_MIGRATION_PLAN — Plano de migração do backoffice

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Fases (§410-420): 1 shell + permissões + auditoria (feito: código); 2 inbox somente leitura (feito, via adapters); 3 filas comerciais (aguarda adapter do tópico 57); 4 dados (58/61); 5 usuários e acessos (preview feito; comandos pendentes); 6 documentos; 7 integrações (status de segredos feito); 8 privacidade (59); 9 observabilidade/suporte (suporte feito, bloqueado por política); 10 central de config (feito); 11 bulk/reparo/emergência (regras feitas).

Para ligar: registrar as chaves no IAM do backend e decidir papéis; ligar as rotas no `app.js`; publicar no OpenAPI; integrar o console no painel; cada módulo dono registra seu adapter e seus handlers. Inventário de operações manuais (quem muda preço, disponibilidade, aprova desconto etc.) depende de entrevista com a operação.
