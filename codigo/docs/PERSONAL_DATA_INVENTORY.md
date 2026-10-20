# Inventário de dados pessoais (mapa de dados a partir do código real)

> Gerado por `node scripts/privacyDocs.js` a partir de `src/privacy/deviceData.js` (INVENTORY), `config/privacy/registries.json` (personalFields) e `config/privacy/governance.json` (legacyFindings). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

## 1. O que fica no aparelho (navegador)

Levantado com `grep` em `plat/src` (literais de chaves de localStorage, nomes de IndexedDB e de Cache Storage). O teste `tests/privacy.test.js` ("data map fitness") falha se surgir uma chave nova fora deste inventário.

| Id | Tipo | Chave / nome | Origem no código | O que guarda | Categorias | Pessoal | "Apagar dados pessoais" |
|---|---|---|---|---|---|---|---|
| LS_STATE | LOCAL_STORAGE | `ws:viva-juara:state` | src/state/store.js (keyOf) | Preferências de interface + sessão; inclui clientes de trabalho (nome, perfil, orçamento, lotes), filtros e favoritos legados | IDENTITY, CUSTOMER_PREFERENCE, FINANCIAL_DECLARED, CUSTOMER_BEHAVIOR | sim | STRIP_PERSONAL_FIELDS |
| LS_STATE_TENANT | LOCAL_STORAGE | `ws:org:org_house7:dev:viva-juara:state` | src/security/organization.js (storageKey, preparado) | Estado por organização (formato futuro) | IDENTITY, CUSTOMER_PREFERENCE | sim | STRIP_PERSONAL_FIELDS |
| LS_STATE_V2 | LOCAL_STORAGE | `ws-state` | src/state/store.js (LEGACY_KEY) | Estado da versão 2 (pode ter clientes e favoritos) | IDENTITY, CUSTOMER_BEHAVIOR | sim | REMOVE |
| LS_LEGACY_FAVS | LOCAL_STORAGE | `vj-favs` | src/state/store.js, src/favorites/favorites.js (primeiro painel) | Favoritos do primeiro painel (ids de lote) | CUSTOMER_BEHAVIOR | sim | REMOVE |
| LS_LEGACY_UI | LOCAL_STORAGE | `vj-ent` | src/state/store.js (primeiro painel) | Preferências de interface antigas (entrada, sol, lote, fundo) | — (necessita validação) | não | KEEP |
| LS_DEVICE_ID | LOCAL_STORAGE | `vj-device-id` | src/presentation/app.js | Id pseudônimo do aparelho (namespace dos favoritos; não é identidade) | DEVICE_TECHNICAL | sim | KEEP |
| LS_LAYOUT | LOCAL_STORAGE | `ws:viva-juara:layout:desktop` | src/layout/workspace.js (prefKey) | Layout do painel por família de aparelho | — (necessita validação) | não | KEEP |
| LS_PWA_INSTALL | LOCAL_STORAGE | `ws-pwa-install` | src/pwa/pwaCore.js (INSTALL_POLICY.storageKey) | Contador de sessões para sugerir instalação | — (necessita validação) | não | KEEP |
| LS_FAVORITES_FALLBACK | LOCAL_STORAGE | `fav:v1:org_house7:dev_x:viva-juara` | src/favorites/favorites.js (nsKey, sem IndexedDB) | Favoritos por organização + aparelho | CUSTOMER_BEHAVIOR | sim | REMOVE |
| IDB_FAVORITES | INDEXED_DB | `ws-favorites` | src/favorites/favorites.js (idbBackend) | Favoritos por organização + aparelho (+ contexto de cliente) | CUSTOMER_BEHAVIOR | sim | REMOVE |
| IDB_ANALYTICS | INDEXED_DB | `vj-analytics` | src/analytics/client.js (idbPersistence; desligado: persistOffline=false) | Fila de eventos de uso pseudônimos (não usada hoje) | ANALYTICS_PSEUDONYMOUS | sim | REMOVE |
| IDB_SYNC_QUEUE | INDEXED_DB | `ws-pwa-queue` | src/pwa/sync.js (IdbMutationStore) | Fila de alterações offline por organização + usuário (vazia no modo visitante) | CUSTOMER_BEHAVIOR | sim | REMOVE |
| IDB_DATA_CACHE | INDEXED_DB | `ws-cache` | src/data/offline.js (DB_NAME) | Cópia offline dos dados de lotes (públicos) | LOT_DATA | não | KEEP |
| IDB_CACHE_L2 | INDEXED_DB | `ws-cache-l2` | src/cache/cacheManager.js (idbKv) | Cache L2 de dados derivados (sem dado pessoal) | LOT_DATA | não | KEEP |
| CS_SHELL | CACHE_STORAGE | `ws-shell-<build>` | src/pwa/swRouting.js, src/sw.template.js | Página e imagens do painel | LOT_DATA | não | KEEP |
| CS_RUNTIME | CACHE_STORAGE | `ws-runtime-v2` | src/pwa/swRouting.js | Respostas públicas em cache | LOT_DATA | não | KEEP |
| CS_PACK | CACHE_STORAGE | `ws-pack:viva-juara` | src/pwa/offlinePack.js (sem notas/cliente: DROP list) | Pacote offline do empreendimento | LOT_DATA | não | KEEP |
| CS_ASSETS | CACHE_STORAGE | `ws:viva-juara:assets` | src/data/offline.js (assets) | Plantas e imagens do empreendimento | LOT_DATA | não | KEEP |

Nomes que parecem armazenamento mas não são: `ws-cache-coherence` (BroadcastChannel entre abas) e `ws-sync` (tag de Background Sync).

Sem `sessionStorage` e sem cookies no painel. Os cookies `__Host-plat_session` / `plat_oauth` existem só no login do backend (W3).

## 2. Campos pessoais (PersonalFieldPrivacyMetadata)

| Campo | Categoria | Finalidades | Etapa de coleta | Retenção | Exportável ao titular | Apagável | Onde está hoje |
|---|---|---|---|---|---|---|---|
| legacyCustomer.name | IDENTITY | CUSTOMER_RELATIONSHIP | CUSTOMER | RET_DEVICE_LOCAL | sim | sim | localStorage ws:<dev>:state prefs.customers[].name |
| legacyCustomer.profile.preferences | CUSTOMER_PREFERENCE | LOT_RECOMMENDATION, CUSTOMER_RELATIONSHIP | CUSTOMER | RET_DEVICE_LOCAL | sim | sim | localStorage ws:<dev>:state prefs.customers[].profile |
| legacyCustomer.profile.constraints.budget | FINANCIAL_DECLARED | LOT_RECOMMENDATION, FINANCIAL_SIMULATION | CUSTOMER | RET_DEVICE_LOCAL | sim | sim | localStorage ws:<dev>:state prefs.customers[].profile.constraints, localStorage ws:<dev>:state prefs.constraints |
| legacyCustomer.lots | CUSTOMER_BEHAVIOR | CUSTOMER_RELATIONSHIP | CUSTOMER | RET_DEVICE_LOCAL | sim | sim | localStorage ws:<dev>:state prefs.customers[].lots |
| share.customerName | IDENTITY | CUSTOMER_RELATIONSHIP | CUSTOMER | — (necessita validação) | não | sim | memória do modal; texto e URL wa.me |
| customer.displayName | IDENTITY | LEAD_INTAKE, CUSTOMER_RELATIONSHIP, PROPOSAL_PREPARATION | LEAD | RET_CUSTOMER_CORE | sim | sim | memória (customerRepository) |
| customer.phone | CONTACT | LEAD_INTAKE, CUSTOMER_RELATIONSHIP | LEAD | RET_CUSTOMER_CONTACT | sim | sim | memória (customerRepository contacts) |
| customer.email | CONTACT | LEAD_INTAKE, CUSTOMER_RELATIONSHIP | LEAD | RET_CUSTOMER_CONTACT | sim | sim | memória (customerRepository contacts) |
| customer.notes | COMMUNICATION_HISTORY | CUSTOMER_RELATIONSHIP | CUSTOMER | RET_COMMUNICATION | sim | sim | memória (journey/decision notes) |
| customer.address | ADDRESS | CONTRACT_PREPARATION | CLOSING | RET_TRANSACTION | sim | não (retenção legal a validar) | não coletado hoje |
| customer.maritalStatus | MARITAL_STATUS | CONTRACT_PREPARATION | CLOSING | RET_TRANSACTION | sim | não (retenção legal a validar) | não coletado hoje |
| customer.cpf | DOCUMENT_IDENTIFIER | CONTRACT_PREPARATION, SIGNATURE_PROCESS, LEGAL_COMPLIANCE | CLOSING | RET_DOCUMENTS | sim | não (retenção legal a validar) | não coletado hoje |
| device.id | DEVICE_TECHNICAL | CUSTOMER_RELATIONSHIP, SECURITY | ANY | RET_DEVICE_LOCAL | sim | sim | localStorage vj-device-id |
| analytics.anonymousId | ANALYTICS_PSEUDONYMOUS | PRODUCT_ANALYTICS | ANY | RET_ANALYTICS | não | sim | memória da aba |
| auth.subjectHash | AUTHENTICATION | SECURITY | ANY | RET_AUTH_SESSIONS | não | sim | Postgres auth_sessions.subject_hash, users.external_identity_id |
| auth.invitationEmailHash | AUTHENTICATION | SECURITY | ANY | RET_AUTH_SESSIONS | não | sim | Postgres organization_invitations.email_hash |
| auth.displayName | IDENTITY | SECURITY | ANY | RET_AUTH_SESSIONS | sim | sim | Postgres auth_sessions.display_name (primeiro nome de conta não convidada) |

## 3. Servidor (backend)

- `auth_sessions`, `auth_used_nonces`, `organization_invitations` (migração 010): só sha256 de sessão, do sujeito Google e do e-mail convidado; `display_name` (até 60 caracteres) de conta não convidada.
- `audit_log`: ids opacos, nunca nome/e-mail/token.
- **Clientes, jornada, decisão e documentos não estão em servidor nenhum hoje** (memória da aba).
- Migração 013 (tópico 59) cria os registros de privacidade (solicitações, consentimentos, legal holds, bloqueios, tombstones, supressões, incidentes), sem dado pessoal em claro.

## 4. Achados de legado (LegacyPrivacyFinding)

| Id | Onde | Categorias | Tipo | Severidade | Remediação |
|---|---|---|---|---|---|
| LPF_LOCAL_CUSTOMER_NAMES | localStorage ws:<dev>:state → prefs.customers[] (src/state/store.js save; criado em src/presentation/app.js 'custAdd') | IDENTITY, CUSTOMER_PREFERENCE, FINANCIAL_DECLARED, CUSTOMER_BEHAVIOR | NO_BASIS_RECORD | MEDIUM | Decisão D59-1: manter nomes no aparelho (com base legal validada e aviso) ou passar a guardar só um apelido/id. Até lá: Central de privacidade permite exportar e apagar; nada é enviado. |
| LPF_SHARE_NAME_IN_URL | src/services/share.js whatsappUrl (wa.me/?text=) com o nome opcional digitado no modal Compartilhar | IDENTITY | UNCONTROLLED_SHARING | MEDIUM | Decisão D59-2: o nome vai na URL do WhatsApp (terceiro) quando o corretor o digita. Opções: aviso no campo, só primeiro nome, ou copiar texto sem URL. |
| LPF_GOOGLE_FONTS | fonts.googleapis.com / fonts.gstatic.com (todas as páginas) | DEVICE_TECHNICAL | UNCONTROLLED_SHARING | LOW | Decisão D50-3 (auto-hospedar as fontes) elimina o terceiro e a possível transferência internacional. |
| LPF_DEVICE_ID | localStorage vj-device-id | DEVICE_TECHNICAL | NO_BASIS_RECORD | LOW | Id pseudônimo (não é anônimo): registrar finalidade/base; apagado em 'Apagar tudo deste aparelho'. |
| LPF_LOCAL_BUDGET | localStorage ws:<dev>:state → prefs.constraints (orçamento da sessão de trabalho) | FINANCIAL_DECLARED | NO_BASIS_RECORD | LOW | Incluído em 'Apagar dados pessoais deste aparelho'. |

## 5. Dados sensíveis

Nenhum campo do código coleta dado sensível (LGPD art. 5º, II). A categoria `SENSITIVE_OTHER` existe só para bloquear: sem finalidade, sem critério de recomendação, sem inferência. Notas livres (jornada/decisão) podem conter dado sensível por descuido: há aviso (`sensitiveTextWarning`) e a categoria é RESTRICTED, nunca persistida no navegador.
