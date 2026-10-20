# Segurança de storage de documentos (Tópico 32)

- **Namespace por organização:** `organizations/{org}/documents/{doc}/versions/{ver}/{asset}`. O caminho organiza; **não** autoriza.
  Toda leitura passa por `decide()` (Topic 30) antes do storage.
- **Quarentena:** scanner é uma porta (`createService({ scanner })`). `MALICIOUS`/`SUSPICIOUS` → `QUARANTINED`, versão `REJECTED`, publicação
  bloqueada (`MALWARE_SUSPECTED`). Sem scanner no frontend: estado `NOT_SCANNED` (aviso) e publicação de documento exige `CLEAN`.
- **Tipo real:** MIME detectado por *magic bytes*; extensão/MIME declarado nunca bastam. SVG/HTML/executável/OLE (macros) são `SCRIPTABLE_CONTENT`
  e bloqueados. ZIP (xlsx/kmz) é reconhecido como contêiner que exige parser com limites (`parserLimits`).
- **Integridade:** `contentChecksum = sha256:` dos bytes; `verifyChecksum` e checagem na validação (`CHECKSUM_MISMATCH`).
- **Download:** `requestDownload` autoriza, audita (classificações `CONFIDENTIAL`/`RESTRICTED`) e emite token `dl_…` de vida curta
  (TTL 300 s, máximo 900 s). A URL não contém storage key nem segredo. Token expirado → `SIGNED_URL_EXPIRED`.
- **Referência externa** (`EXTERNAL_REFERENCE`): nunca baixável pela plataforma; marcada `EXTERNAL_SOURCE_MUTABLE`; autoridade oficial exige cópia gerenciada.
- **Cache/offline:** só metadados por padrão; conteúdo privado não vai para cache offline; chaves `org:{org}:…`; troca de organização/logout limpa.
- **Sem segredos no frontend:** nenhum token de provedor, URL assinada persistente ou credencial em config/código.

Backend (a fazer): object storage com criptografia em repouso, URLs pré-assinadas geradas no servidor, scanner (ex.: ClamAV) assíncrono,
retenção/legal hold no bucket, auditoria em tabela append-only.
