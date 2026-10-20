# Segurança de documentos e uploads

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Pipeline (config/security/uploadPolicy.json, `checkUpload(file, policyId)`)
tamanho → allow-list de extensão → extensão × MIME declarado × **magic bytes** (`sniffMime`) → scanner de malware (D50-6, hoje ausente → status `PENDING_SCAN`) → quarentena → liberação.

| Política | Tipos | Limite |
|---|---|---|
| `document` | PDF, PNG, JPEG | conforme JSON |
| `image` | PNG, JPEG, WebP (sem SVG — SVG executa script) | conforme JSON |
| `geometry` | GeoJSON, KML, KMZ | + limites de vértices/feições (`inputLimits`) |

- O nome do arquivo é **metadado** (`normalizeFilename`): remove caminho, `..`, controles, bidi/RTLO e dupla extensão enganosa. Ele nunca é usado como caminho. O caminho é o id gerado no servidor.
- Arquivos (`checkArchive(entries, 'kmz')`): bloqueia zip slip (`../`, absoluto, drive), zip bomb (razão de compressão, total descompactado, nº de entradas) e entradas aninhadas.
- Download de documento restrito = ação de alto risco `DOCUMENT_RESTRICTED_DOWNLOAD` (permissão proposta `document.download`). Ele usa URL assinada de curta duração (`SIGNED_ASSET_TOKEN`), servida com `Content-Disposition: attachment` + `nosniff`.
- Exportação CSV: toda célula passa por `csvCell`, que neutraliza `= + - @ \t \r` (fórmula/DDE) e aplica aspas.

## Estado atual
O painel estático não recebe upload. O backend ainda não tem endpoint de upload. Este documento é o contrato, e a lógica pura já está testada (`security50.test.js`: uploads/archives/CSV).
