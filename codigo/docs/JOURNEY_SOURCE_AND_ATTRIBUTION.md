# Origem e atribuição (Tópico 40)

- `JourneyAcquisitionContext { id, journeyId, firstTouch, latestTouch?, primarySourceCode, primaryAttributionRule, externalLeadRef?, capturedAt }`.
- Registro de origens: WEBSITE, PAID_MEDIA, ORGANIC_SOCIAL, REFERRAL, BROKER, EVENT, CRM_REACTIVATION, DIRECT, PARTNER, OTHER, UNKNOWN. Código fora do registro → `UNKNOWN` (aviso `UNKNOWN_SOURCE_CODE`); origem nunca inventada.
- `normalizeTouch`: `landingPageRef` sem query string/fragmento (UTM com e-mail não passa), `referrerDomain` só o domínio, campos de campanha sem dados de contato.
- First touch imutável (serviço recusa segunda captura: `FIRST_TOUCH_IMMUTABLE`); latest touch evolui (`updateLatestTouch`).
- Regra primária explícita: `primaryAttributionRule = FIRST_TOUCH` (decisão a validar com marketing). Analytics de conversão por origem fica para os tópicos 44/45.
