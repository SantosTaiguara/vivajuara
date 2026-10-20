# Política de acesso a documentos (Tópico 32)

Classificação qualifica; a autorização (Tópico 30, chaves de permissão) decide. `App.documents.decide(doc, { action, version, access })`.

| Classificação | Leitura | Download | Cliente | Esconde existência | Audita download |
|---|---|---|---|---|---|
| PUBLIC | `document.read` | `document.download` | sim (só versão publicada) | não | não |
| ORGANIZATION_INTERNAL | `document.read` | `document.download` | não | não | não |
| CONFIDENTIAL | `document.read.confidential` | `document.download` | não | não | sim |
| RESTRICTED | `document.read.restricted` | `document.download` | não | **sim** (404) | sim |

- Outra organização: sempre "não encontrado" (`TENANT_MISMATCH` interno, nunca revelado).
- Rascunho/versão não publicada: só `document.manage`/`document.validate`; modos `TECHNICAL`/`AUDIT` veem versões substituídas.
- Coleção e pacote para cliente nunca ampliam o acesso de cada documento; o pacote é snapshot explícito de versões publicadas e seguras.
- **Deny by default:** as chaves `document.*` ainda não estão em `config/security/permissions.json`; até serem registradas, `App.authz`
  nega (`UNKNOWN_PERMISSION`). Adaptador: `App.documentServices.accessFromAuthz(mode)`.
- localStorage nunca é autorização.

Chaves sugeridas para o registro de permissões: `document.read`, `document.download`, `document.upload`, `document.update`,
`document.validate`, `document.publish`, `document.archive`, `document.manage`, `document.read.confidential`, `document.read.restricted`.
