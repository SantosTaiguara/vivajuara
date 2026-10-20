# Deploy V2 — ambientes, CI/CD, rollback, backup e segurança

> Situação atual: **nada está hospedado**. O backend existe como código, migrations, scripts e testes, verificados localmente (PostgreSQL 16 + Node 22). A escolha de hospedagem, do PostgreSQL gerenciado e do object storage é uma **decisão humana pendente** (seção 9).

## 1. Componentes

| Componente | Deploy | Observação |
|---|---|---|
| Frontend (estático) | hospedagem atual | segue funcionando sem backend (`useBackendData: false`) |
| API (`plat/backend`) | 1 processo Node 22 (monólito modular) | stateless; pode ter N instâncias atrás de um balanceador |
| PostgreSQL 16 | serviço gerenciado com backup automático e PITR | PostGIS quando disponível |
| Object storage / CDN | S3 ou equivalente | planta, aérea, KMZ, PDFs; banco guarda só metadados |

O backend precisa do diretório `plat/src` (domínio compartilhado) no artefato de deploy — `SHARED_SRC_DIR` aponta para ele (padrão `../src`). Mesmo domínio via reverse proxy (`domínio.com/api`) ou subdomínio (`api.domínio.com`) — ambos funcionam; com subdomínio, configure `CORS_ORIGINS`.

## 2. Ambientes (§19)

| | development | staging | production |
|---|---|---|---|
| `NODE_ENV` | development | staging | production |
| API URL (frontend `dataSource.apiBaseUrl`) | `http://127.0.0.1:8080/api/v1` | `https://api-staging…/api/v1` | `https://api…/api/v1` |
| Banco | local/descartável | gerenciado, dados importados do mesmo `lots.json` | gerenciado, backups + PITR |
| `CORS_ORIGINS` | localhost | URL do frontend de staging | URL(s) do frontend de produção (nunca `*`) |
| `ADMIN_API_TOKEN` | vazio (escrita desligada) ou token local | token do cofre para homologar a escrita | vazio até decisão; quando definido, ≥ 32 caracteres, só no gerenciador de segredos |
| `WRITES_ENABLED` | vazio | vazio | vazio; `false` desliga a escrita mesmo com token (chave de emergência). `true` + `WRITE_API_KEY` = credencial legada (deprecated) |
| `fallbackToJson` (frontend) | true | true | true durante a transição; false após estabilizar (fase 11) |
| Logs | stdout | stdout → coletor | stdout → coletor com retenção |

### Variáveis de ambiente

Todas em `.env.example` (sem segredos). Em staging/produção injete pelo gerenciador de segredos da plataforma; **nunca** commite `.env`.

`NODE_ENV, HOST, PORT, DATABASE_URL, DB_POOL_MAX, DB_SSL, DB_IDLE_TIMEOUT_MS, DB_CONNECT_TIMEOUT_MS, DB_STATEMENT_TIMEOUT_MS, CORS_ORIGINS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, REQUEST_TIMEOUT_MS, BODY_LIMIT_BYTES, COMPRESSION, TRUST_PROXY, ADMIN_API_TOKEN, WRITES_ENABLED, WRITE_API_KEY (legado), ADMIN_BODY_LIMIT_BYTES, IDEMPOTENCY_TTL_SECONDS, SSE_HEARTBEAT_MS, SSE_POLL_INTERVAL_MS, SSE_LISTEN, SSE_MAX_CLIENTS, SSE_RETRY_MS, SSE_MAX_LOTS_PER_EVENT, ASSET_BASE_URL, SHARED_SRC_DIR, SHARED_CONFIG_DIR, LOG_LEVEL, SERVICE_VERSION`.

A configuração é validada na partida: sem `DATABASE_URL` o processo não sobe; em produção `CORS_ORIGINS=*`, `WRITES_ENABLED=true` sem `ADMIN_API_TOKEN` e `ADMIN_API_TOKEN` com menos de 32 caracteres são recusados. O stream SSE precisa de proxy sem buffering (`X-Accel-Buffering: no` já é enviado) e com timeout de leitura maior que `SSE_HEARTBEAT_MS`; cada instância mantém uma conexão `LISTEN` do pool enquanto houver clientes.

Pool de conexões (§120): `DB_POOL_MAX` por instância × número de instâncias deve caber no limite do banco gerenciado (ex.: 2 instâncias × 10 = 20). Em serverless, usar um pooler (PgBouncer/proxy do provedor).

## 3. Pipeline CI/CD (§124)

1. **Instalar**: `cd plat/backend && npm ci` (única dependência: `pg`).
2. **Testes**: subir um PostgreSQL 16 de serviço no CI e rodar `TEST_DATABASE_ADMIN_URL=postgres://postgres:…@localhost:5432/postgres npm test` (contrato de todos os endpoints, importação idempotente, 409/422/400, falha parcial, paridade 498/498, migrations reversíveis).
3. **Verificar migrations**: `npm run migrate:check` contra o banco do ambiente (detecta migration pendente ou arquivo editado após aplicado).
4. **Build/artefato**: empacotar `plat/backend` + `plat/src` (ou imagem Docker `node:22-alpine` com ambos; Docker é opcional, §123).
5. **Backup** do banco de destino (snapshot do provedor ou `pg_dump`).
6. **Migrations**: `npm run migrate` (advisory lock impede execução concorrente). Estratégia *expand → migrate → contract*: migrations aditivas antes do deploy do código; remoções só numa versão posterior, quando nenhum código antigo depende da coluna (§125).
7. **Deploy** do código (rolling/blue-green) com health check `GET /health/ready`.
8. **Dados** (quando houver novo dataset): `npm run import:dry-run` → revisão do relatório → `npm run import`.
9. **Verificação pós-deploy**: `npm run shadow-compare -- --api https://…/api/v1` (deve dar `PARITY OK`) e checagem de `/health`.
10. **Frontend**: só depois, ligar `useBackendData` no ambiente (feature flag, §46/§127). Canário opcional (§129).

## 4. Rollback (§126)

| Camada | Estratégia |
|---|---|
| Frontend | voltar `useBackendData: false` (volta para o JSON publicado) ou republicar a versão anterior |
| Código do backend | redeploy da versão anterior (o processo é stateless) |
| Migrations | preferir **nova migration forward** que desfaz a mudança. Cada migration tem `migrations/down/*.down.sql` testado (`npm test` desce e sobe todas), mas `migrate down --confirm` é **bloqueado em produção** por apagar dados |
| Dados publicados | voltar o ponteiro corrente (`current_analysis_version_id`, `current_price_table_id`) para a versão anterior — versões não são apagadas |
| Dados corrompidos | restaurar backup (seção 5) |

## 5. Backup e restore (§82–83, §181)

Produção: backup automático diário + PITR do provedor, retenção mínima de 7–30 dias (decisão pendente). Além disso, `pg_dump` antes de cada migration/importação.

**Procedimento de teste de restore** (executar mensalmente e antes do cutover; foi executado localmente nesta entrega):

```bash
# 1. backup lógico
pg_dump -h <host> -U <user> -Fc -f plat_$(date +%F).dump <db>
# 2. restaurar em banco descartável
createdb -h <host> -U <user> plat_restore_test
pg_restore -h <host> -U <user> -d plat_restore_test --no-owner plat_<data>.dump
# 3. verificar schema e contagens
DATABASE_URL=postgres://…/plat_restore_test npm run migrate:check
psql … -c "select count(*), md5(string_agg(id||checksum||geometry_checksum, ',' order by id)) from lots"   # comparar com a origem
# 4. verificar dados ponta a ponta: subir a API apontando para o banco restaurado e rodar
DATABASE_URL=postgres://…/plat_restore_test PORT=8081 node src/server.js &
npm run shadow-compare -- --api http://127.0.0.1:8081/api/v1     # deve dar PARITY OK
# 5. descartar o banco de teste e registrar data, tamanho do dump e resultado
```

Resultado local (2026-10-07): dump de 281.648 bytes; banco restaurado com 498 lotes e hash agregado idêntico à origem (`66b0628c…`); `migrate:check` ok; shadow compare contra o banco restaurado `PARITY OK` (498/498).

O arquivo `lots.json` original de cada importação fica em `backups/` com `.sha256`; em produção, copie-o também para o object storage (bucket versionado).

## 6. Assets / object storage (§12–14)

Chave de armazenamento endereçada por conteúdo: `developments/<id>/<chave>/<sha256[0:12]>/<arquivo>` → pode ser servida pela CDN com cache imutável. Passos quando houver bucket: (1) enviar os arquivos de `dash/` para essas chaves (o importador já registrou tamanho e sha256); (2) definir `ASSET_BASE_URL` (CDN/bucket público ou URL assinada no futuro); (3) o endpoint `/assets` passa a devolver `url`. Upload pela API não foi implementado (§90).

## 7. Baseline de segurança (§84–89, §215)

- HTTPS obrigatório em produção (terminação no balanceador/proxy; `TRUST_PROXY=true` só atrás de proxy confiável); HSTS enviado em produção.
- CORS restrito por allowlist; rate limit por IP (em memória — com várias instâncias, mover para Redis ou para o WAF/gateway, §145).
- Validação server-side de todo parâmetro, query (allowlist) e corpo (whitelist de campos, tipos, enums, tamanhos, `Content-Type`, limite de 16 KB).
- Queries parametrizadas; usuário do banco da aplicação **sem** permissão de DDL em produção (migrations rodam com um usuário separado).
- Erros sem stack trace/SQL/caminhos; logs sem corpos de requisição nem segredos.
- Segredos só no gerenciador de segredos; nenhum segredo no frontend; frontend nunca acessa o banco.
- Escrita desabilitada enquanto `ADMIN_API_TOKEN` estiver vazio; quando definido, `Authorization: Bearer <ADMIN_API_TOKEN>` (sha256 comparado em tempo constante; o token nunca é logado) até a autenticação de usuários (tópico próprio) substituir o mecanismo; `audit_log` registra cada alteração com `request_id` e ator `"admin"`. Rotas administrativas aceitam `Idempotency-Key` (tabela `idempotency_keys`, validade 24 h).
- Regras críticas no servidor: transição de status validada pela máquina de estados compartilhada dentro da transação (409/422).
- Cabeçalhos: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy: default-src 'none'`.
- Dependências: `npm audit` no CI (hoje 0 vulnerabilidades, 1 dependência direta).

## 8. Observabilidade (§93–96)

Logs JSON em stdout (`timestamp, level, requestId, method, route, statusCode, duration, errorCode`); `X-Request-Id`/`traceId` correlaciona cliente, log e `availability_history`/`audit_log`. Pontos futuros: métricas (contagem, latência, taxa de erro, latência do banco), Sentry/equivalente no handler de erro 500, alerta quando o frontend registrar `API_FALLBACK_JSON`.

## 9. Decisões humanas pendentes

1. **Hospedagem da API** (container gerenciado, VM ou serverless — avaliar cold start, conexões e WebSocket futuro, §121) e domínio (`api.` vs `/api`).
2. **PostgreSQL gerenciado** (provedor, região, tamanho, PITR, retenção de backup, PostGIS disponível?).
3. **Object storage/CDN** para assets e política de URL (pública × assinada).
4. **Autenticação/autorização** (tópico próprio) antes de ligar escrita em produção; até lá, quem guarda o `ADMIN_API_TOKEN`.
5. **Fonte de verdade da disponibilidade** (espelho de vendas da loteadora/ERP/CRM): quem escreve, com que frequência, e se o frontend fará polling.
6. Quando desligar o fallback JSON (fase 11) e se endpoints comerciais passam a ser privados.
