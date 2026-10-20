# Release e mudanças operacionais

- Marcador de release: `platform.setRelease({ appVersion, buildId, commit, deployedAt })`. Todo sinal leva `appVersion`/`buildId`; cada grupo de erro guarda a versão em que apareceu (cenário `ObsDeployMarkerRegression`: erros antes e depois da troca de versão ficam separados).
- Hoje o painel conhece a versão do build pelo Service Worker (`scripts/build.js` gera um hash de 10 caracteres); a integração deve chamar `setRelease({ appVersion: <hash do sw> })` quando o SW responder. Sem isso, a versão aparece como "web".
- OperationalChangeEvent: `platform.recordChange(eventType, { versionRef, correlationId, metadata })` com `eventType` normalizado (DEPLOYMENT, CONFIG_CHANGE, FEATURE_FLAG_CHANGE, PRICE_ACTIVATION, ANALYSIS_ACTIVATION). Metadata passa pela redaction. Uma troca de versão registra DEPLOYMENT automaticamente. Linha do tempo de até 50 mudanças na "Saúde da plataforma".
- Change event ≠ Audit: pode referenciar um AuditEvent, mas não o substitui.
- Flags: registrar o conjunto controlado de flags no trace/log quando alterar comportamento; flags nunca viram label de métrica.
- Regressão pós-deploy: comparar erros, latência, mapa interativo e 5xx por versão. Canary/rollout gradual: futuro.
- Migrações de banco: `db_migration_duration_ms{outcome}` e versão de schema em `/health/ready` (já retorna `schemaVersion`).
