# Relatório — Tópico 42: ShareService

## Entregue
- `src/share/shareDomain.js` → `App.share.domain`: enums, registro de políticas (PRESENTATION/LOT/FINANCIAL/DOCUMENT_DENY), headers de segurança, permissões, token CSPRNG + hash, validador de URL, Definition/Grant/ciclo de vida, `evaluateAccess` com erros públicos genéricos, preview de bots, assets, estado inicial, mapa de jornada, VM de gestão, inventário legado.
- `src/share/shareService.js` → `App.share.service`: `createShareService(...)` com issue/rotate/revoke/suspend/resume/changeExpiry/exchange/resource/asset/feedback/channelPayload/markAsSent/onDomainEvent/createLotSnapshot; templates de canal validados.
- `src/share/sharedShellView.js` → `App.sharedShellView` (UI pública + gestão).
- `backend/src/modules/share/share.tokens.js`: geração, HMAC com pepper, verificação em tempo constante, scrypt de passcode, redação (CommonJS, sem DB).
- Testes: `tests/share.test.js` (26).
- Documentos: SHARE_SERVICE_ARCHITECTURE, _GRANT_AND_TOKEN_SECURITY, _POLICY_REGISTRY, _ACCESS_AND_REVOCATION, _CHANNEL_PAYLOADS, _RESOURCE_AND_ASSET_SECURITY, _PUBLIC_RUNTIME_SECURITY, _FRESHNESS_AND_SAFETY_POLICY, _LEGACY_LINK_MIGRATION_REPORT, _TEST_MATRIX.
- `src/services/share.js` (`deepLink`) **não** foi alterado: continua como deep link interno.

## Contratos de backend
- Tabelas: ver SHARE_GRANT_AND_TOKEN_SECURITY.md (`share_definitions`, `share_grants`, `share_tokens`, `share_passcodes`, `share_sessions`, `share_access_events`, `share_revocations`).
- Endpoints internos: `POST /shares` → `ShareGrantCreateResultDto {grant, url}` (token só aqui), `GET /shares?resourceId=`, `POST /shares/{id}/revoke|suspend|resume|rotate`, `PATCH /shares/{id}/expiry`, `POST /shares/{id}/channel-payload`, `POST /shares/{id}/mark-sent`.
- Públicos: `GET /s/{token}` (shell + headers; bots → metadados genéricos), `POST /s/{token}/exchange` (passcode/confirmação; → sessão curta + CSRF), `GET /share-sessions/{ref}/resource`, `GET /share-sessions/{ref}/assets/{id}`, `POST /share-sessions/{ref}/feedback`.
- Expiração, revogação, consumo único (UPDATE condicional), rate limit e auditoria: **somente no backend**. O frontend nunca autoriza por token.
- Env: `SHARE_TOKEN_PEPPER` (≥16 caracteres, segredo de servidor), `SHARE_PUBLIC_ORIGIN`.

## Adiado
Persistência; resolvers de COMPARISON_SNAPSHOT e FAVORITE_COLLECTION_SNAPSHOT; modo AUTHENTICATED/EMAIL_CHALLENGE; envio real de e-mail/WhatsApp; geração da imagem do QR; watermark; rate limit distribuído; substituição do texto legado de WhatsApp em `viewmodels.js`.

## Decisões humanas
1. TTLs (7/30 dias apresentação e lote; 2/7 dias financeiro).
2. Origem pública dos links e gestão do pepper.
3. Substituir o texto legado de WhatsApp (nome, preço e status na URL).
4. Registrar `share.extendExpiry`, `share.viewAccessHistory` e `share.overridePolicy` no backend.
5. Reaproveitar grant ativo ou sempre criar novo.
6. Watermark.
7. Liberar link com dado UNKNOWN (hoje: libera com ressalva; financeiro bloqueia se desatualizado).
