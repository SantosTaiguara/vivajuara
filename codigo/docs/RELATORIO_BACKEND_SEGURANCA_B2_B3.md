# Relatório — Backend: patches de segurança B2 e B3 (tópicos 50/51)

> 2026-10-12 · só `backend/` (e este relatório). Continua `RELATORIO_TOPICO_50.md` (B1 já aplicado em `shared/http/middleware.js`).

## B2 — Rate limit por categoria
- Novo `backend/src/shared/http/rateLimitPolicies.js`: lê `config/security/rateLimits.json` (somente leitura; `RATE_LIMIT_POLICIES_FILE` sobrescreve). Se o arquivo faltar, usa cópia embutida dos mesmos valores (fail closed).
- `global.ip` continua no limitador existente (`RATE_LIMIT_MAX`). Leituras públicas ficam só nele.
- Classificação pelo **template** da rota, nunca pelo caminho bruto:
  - `search` (busca de lotes);
  - `analysis.expensive` (prévia de análise);
  - `admin.write` (toda rota `write`/`admin`, chave usuário + endpoint);
  - `upload`, `export.bulk`, `auth.login`, `auth.passwordReset`, `share.validate` e `share.validate.token`: já classificadas para as rotas futuras.
- Chaves: IP corrigido (B1), usuário, organização (`X-Organization-Id` em formato seguro), endpoint e prefixo do share token. Ficam guardadas só como sha256 truncado, nunca o IP ou o token.
- Duas fases:
  - antes da autenticação: políticas por IP (bloqueia força bruta antes de tocar no banco);
  - depois da autenticação: políticas por usuário. Anônimo cai no balde do IP.
- Capacidade = `maxRequests + burst`. THROTTLE e REJECT respondem `429 RATE_LIMITED` + `Retry-After`, com mensagem genérica. O id da política só aparece no log (`rateLimitPolicy`).
- Mapa em memória por instância, limitado a 50 mil chaves e com varredura periódica.
- Config `RATE_LIMIT_POLICIES`: ligado por padrão; desligado por padrão só em `NODE_ENV=test`, porque as suítes com Postgres fazem centenas de escritas. Fora de test, desligar gera aviso no log.

## B3 — Redação central no logger
- `shared/logging/logger.js`: toda entrada passa por `redact()` antes do `JSON.stringify`. As regras de chave vêm de `config/observability/policy.json` via `telemetry.redactionRules`.
  - Chaves bloqueadas são removidas: authorization, cookie, token, share token, senha, segredo, CPF, e-mail, telefone, notas, body, nome, url, query…
  - Chaves de id pessoal viram `[mascarado]`.
  - Valores são redigidos no texto (inclusive em `msg`, `detail` e `stack`): Bearer/Basic, JWT, `/s/<token>`, `?token=`, dev tokens, URL de banco com credencial, CPF/CNPJ, e-mail, telefone BR e segredos longos.
  - Ids técnicos (`requestId`, `traceId`…) ficam isentos.
  - Profundidade, arrays e strings têm limite. O objeto do chamador não é alterado.
- `stack`:
  - em produção nunca é gravado (`createLogger({ production })`; `app.js` também deixa de enviá-lo no caminho de 500);
  - fora de produção é cortado em 8 frames e redigido.
- O campo `url` do log "server started" passou a se chamar `listen`.

## Telemetria (tópico 51) ligada ao app (sem banco, baixo risco)
- `GET /health/live` → `{ "status": "ok" }`. Documentado no openapi (schema `Live`), em `API_ARCHITECTURE.md` e `API_CHANGELOG.md`, sem mudar a versão do contrato.
- `traceparent` W3C válido e `X-Correlation-Id` em formato seguro são aceitos. A resposta traz `X-Correlation-Id` (exposto no CORS) e o log de request ganha `correlationId` e `traceId`.
- Métricas RED/`/metrics` continuam fora (decisão O1).

## Testes
- `backend/tests/securityB2B3.test.js`: 8 testes `node:test`, sem Postgres (pool falso). Cobrem políticas, classificação, janela/burst/fases, redação, stack em produção, `/health/live`, correlação e 429 real após 60+20 buscas.
- Verificações:
  - `npm run openapi:check` ok;
  - `tests/backend/api.openapi.test.js` 5/5;
  - suíte do frontend 1067/1067.
- Não rodados: testes com banco (sem senha do Postgres).

## Pendências / decisões
- Rate limit distribuído (Redis/edge) ao escalar horizontalmente. `account` em `auth.login` exige ler o corpo; hoje a chave é só o IP.
- Os limites do JSON (por exemplo admin.write 30/min, search 60+20) precisam ser confirmados com o uso real.
- Retenção e destino de logs: decisões O1/O4.
