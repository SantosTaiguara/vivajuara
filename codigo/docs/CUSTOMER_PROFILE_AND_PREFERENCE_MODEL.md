# Perfil e preferências do Customer (Tópico 39)

O antigo `CustomerProfile` do tópico 14 (`docs/CUSTOMER_PROFILE_SCHEMA.md`) continua sendo o formato que o Fit lê. O tópico 39 cria a camada persistente e versionada acima dele: `CustomerPreferenceProfile` → `CustomerPreferenceProfileVersion` → `CustomerProfileSnapshot`. A metodologia de Fit e Recommendation não muda.

## CustomerPreferenceProfileVersion

| Campo | Regra |
|---|---|
| `id`, `profileId`, `customerId`, `organizationId` | ids opacos |
| `version` | 1, 2, 3…; `supersedesVersionId` aponta para a anterior |
| `schemaVersion` | `customer-profile/1` |
| `objective` | `LIVE`, `INVEST`, `LIVE_OR_INVEST`, `UNDECIDED` ou ausente. `UNDECIDED` é resposta; ausência é "não informado". Nunca `LIVE` por padrão |
| `preferences[]` | `{ key, fieldKey, target, importance LOW/MEDIUM/HIGH, source, explicit, active }`; `key` precisa existir no catálogo do Fit (`config/fit/viva-juara.json`) |
| `hardConstraints[]` | `{ key, value, source }`; `key` precisa existir em `config/recommendation/viva-juara.json → constraints` |
| `budgetProfile` | valores `MoneyValue { amount > 0, currency }`; desconhecido = ausente (0 é rejeitado: `INVALID_MONEY`); `dataState` `PROVIDED / NEEDS_CONFIRMATION / UNKNOWN / NOT_AVAILABLE` |
| `profileCompleteness` | `{ ratio, answered, missing }` — completude, não confiança |
| `sourceSummary` | contagem por origem |
| `checksum` | do conteúdo semântico; conteúdo igual → nenhuma versão nova (`unchanged`) |

Versões salvas são congeladas (`Object.freeze` profundo) e o repositório é append-only.

## Origens

`CUSTOMER_EXPLICIT`, `BROKER_RECORDED` (padrão: o que o corretor digita no painel), `IMPORTED`, `SYSTEM_SUGGESTED_UNCONFIRMED`. Uma sugestão do sistema entra sempre com `active = false` (aviso `SUGGESTION_NOT_ACTIVATED`) e não chega ao Fit; não pode ser restrição.

## Preferência ≠ restrição

"Prefiro até R$ 330 mil" → preferência `budget` (peso no Fit). "Não aceito acima de R$ 330 mil" → restrição `budgetMax` (elimina na Recommendation). Nenhuma conversão automática entre as duas.

## Completude

Itens (`config/customer/policy.json → completeness`): objetivo, orçamento (estado diferente de UNKNOWN), ao menos uma preferência ativa, exigências revisadas. Não é exigida para atender ou recomendar.

## Ponte com o painel

`fromUiState({ preferences: {quiet: 3}, constraints: {budgetMax: 330000} })` gera a entrada de versão; `toUiState(version)` devolve o formato do painel; `toFitProfile(version)` gera o perfil do Fit pelo `buildProfile` existente (prova em teste: mesmo `profileVersion` e mesmos Fit nos 498 lotes). O `objective` do painel (`housing`, `investment`, `family`, `premium`) é lente de score, **não** objetivo do cliente: não é mapeado (decisão humana pendente).

## Snapshot

`createSnapshot(version, customer, purpose)` guarda só `profileVersionId`, `customerRevision`, `preferenceChecksum`, `purpose`, ids e data. Recomendações antigas continuam apontando para a versão usada (V1), mesmo depois de V2.

## Grupos do Profile Builder

Configurados em `profileBuilderGroups` (Objetivo, Orçamento, Tamanho, Sol, Ruído, Privacidade, Lazer, Entrada, Área verde, Investimento, Outras) apenas com critérios suportados.
