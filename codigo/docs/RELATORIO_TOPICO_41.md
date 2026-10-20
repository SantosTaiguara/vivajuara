# Relatório — Tópico 41: Modo de Apresentação

## Entregue
- `src/presentationmode/policy.js` → `App.presentationMode.policy`: política client-safe `client-safe-41.1.0` (allow-list, deny by default), CustomerDisplayPolicy, wording pt-BR, detector de vazamento.
- `src/presentationmode/projection.js` → `App.presentationMode.projection`: projeções por domínio (lote, preço de tabela, disponibilidade, recomendação, comparação, financeiro, mapa, cliente, próximos passos).
- `src/presentationmode/domain.js` → `App.presentationMode.domain`: permissões, registro de blocos, templates, Definition (revision), preflight com overrides restritos, Snapshot imutável com checksum, safety status, repositório em memória.
- `src/presentationmode/runtime.js` → `App.presentationMode.runtime`: sessão/navegação, overlays, feedback, offline, tema/layout, restauração, pedido de exportação, inventário legado.
- `src/presentationmode/presentationView.js` → `App.presentationView` (UI).
- Alteração compartilhada (aditiva): `src/config/presentation.js` — `clientDenyByDefault` + `clientSafeFields`; `isFieldVisible` aplica a allow-list.
- Testes: `tests/presentationmode.test.js` (36).
- Documentos: PRESENTATION_MODE_ARCHITECTURE, _CLIENT_SAFE_PROJECTION_POLICY, _BLOCK_REGISTRY, _PREFLIGHT_POLICY, _SNAPSHOT_AND_VERSIONING, _RUNTIME_AND_NAVIGATION, _SECURITY_AND_REDACTION, _OFFLINE_POLICY, _LEGACY_MIGRATION_REPORT, _TEST_MATRIX.

## Contratos de backend (não implementados: sem acesso ao banco)
- Tabelas: `presentation_definitions` (org_id, revision, blocks jsonb, storyline, customer_ref, status), `presentation_snapshots` (insert-only, audience jsonb, internal_refs jsonb, checksum, policy_version, generated_at, safety_status), `presentation_sessions`, `presentation_feedback`, `presentation_audit_events`.
- Endpoints: `POST /presentations`, `PATCH /presentations/{id}` (If-Match: revision), `POST /presentations/{id}/preflight`, `POST /presentations/{id}/snapshots`, `GET /presentation-snapshots/{id}/audience` (só `audience`), `POST /presentation-snapshots/{id}/safety`, `POST /presentation-sessions`, `POST /presentation-sessions/{id}/feedback`, `POST /presentation-snapshots/{id}/export`.
- Permissões a registrar: `presentation.read/create/update/archive/preview/snapshot.create/session.start/feedback.record` (interinas → `lot.view`); `presentation.internalNotes.read`, `presentation.preflight.override`, `presentation.theme.manage` (hoje `null` = negadas).

## Adiado
Persistência e auditoria duráveis; exportação PDF; LIVE com dados privados servidos pelo backend; integração em `app.js`/build (arquivos protegidos); bloco CUSTOM rico; tema por organização.

## Limitação
Frontend estático: o painel ainda carrega `lots.json` completo (público, sem PII). O modo novo só exibe `snapshot.audience`, mas isso não é barreira de segurança enquanto não houver backend.

## Decisões humanas
1. Limite de frescor (padrão 24 h).
2. Exibir percentual de compatibilidade (`showFitPercent`, padrão não).
3. Exibir orçamento do cliente (`showBudget`, padrão não).
4. Quais códigos de preflight aceitam override.
5. Política offline (cache de snapshot desligado).
6. Inclusão das permissões novas no registro do backend.
