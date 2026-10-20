# Segurança do pacote offline

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

- Classe do pacote: ORGANIZATION; recursos só PUBLIC_SAFE (o build rejeita outra classe: SECURITY_CLASS_FORBIDDEN). Sem cliente, jornada, compartilhamento, autenticação, documentos (§75, §167).
- Isolamento: o pacote da organização A não aparece nem é lido na organização B (`list`, `read`, `inspect.access = OTHER_ORGANIZATION`).

## OfflinePackSecurityPolicy (padrão)
`{"allowOrganizationPackPersistenceAfterLogout":true,"allowSensitiveResources":false,"clearOnUserSwitch":false,"requireReauthBeforeAccess":false}`

## OfflineAuthPolicy (padrão — revisar no tópico 50)
`{"allowPreviouslyAuthenticatedOfflineUse":true,"maxOfflineSessionAgeMs":604800000,"requireLocalUnlock":false,"allowedFeatureCodes":["APP_SHELL","MAP","LOT_SEARCH","LOT_QUICK_VIEW","ANALYSIS_LAYERS","TECHNICAL_EXPLANATION","AVAILABILITY","PRICING","PRICE_HISTORY","FINANCIAL_SIMULATION","COMPARISON","MOBILITY_ROUTES","AERIAL_VIEW","GALLERY","PRESENTATION_IN_PERSON"]}`
- Sem senha nem token de longa duração guardados para "fazer o offline funcionar" (§85, §86).
- Uso offline após login limitado por `maxOfflineSessionAgeMs` (7 dias): depois disso "Conecte-se para confirmar seu acesso aos dados offline" (REVALIDATION_REQUIRED).
- **Revogação não é instantânea enquanto o aparelho está totalmente offline** (§292). Na primeira revalidação após reconectar, `onAccessRevoked(org)` remove os pacotes da organização (§293).

## Ciclo de vida
| Evento | Efeito |
|---|---|
| logout | mantém pacote organizacional (padrão) ou remove (dispositivo compartilhado) |
| troca de usuário | `clearOnUserSwitch` (padrão: não; nada do usuário está no pacote) |
| troca de organização | pacote da outra organização fica invisível |
| acesso revogado | pacotes da organização removidos |
| esquema incompatível | UPDATE_REQUIRED, nunca interpretado em silêncio |

## Expiração (§283–§285)
Sem TTL universal: `{"id":"pack-expiration.default","GEOMETRY_BUNDLE":null,"BASE_MAP_MEDIUM":null,"BASE_MAP_HIGH":null,"TECHNICAL_ANALYSIS_INPUT":null,"MOBILITY_ROUTES":null,"GALLERY_INDEX":null,"GALLERY_IMAGE":null,"PRICING_SNAPSHOT":null,"AVAILABILITY_SNAPSHOT":null,"note":"limite de idade do preço/disponibilidade offline é decisão de negócio; sempre exibidos como última informação conhecida."}`.
