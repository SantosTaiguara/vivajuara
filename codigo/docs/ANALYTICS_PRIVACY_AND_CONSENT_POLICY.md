# Privacidade e consentimento (analytics)

Política executada: `config/analytics/policy.json`. O código não interpreta a lei; os pontos abertos estão em “decisões”.

## Nunca capturar (chaves)
telefone/celular/whatsapp, e-mail, CPF/CNPJ/RG, nome/nome completo, endereço/CEP, notas/observações, corpo de mensagem, conteúdo de documento, tokens (auth/share/access/refresh), senha/passcode/segredo/API key, URL/href/referrer/landing URL, consulta/termo de busca cru, renda/orçamento/entrada/parcela, preço, IP/user agent, notas do apresentador. Também por fragmento (`token`, `password`, `email`, `phone`, `cpf`, `secret`, `notes`…).

## Detectores de valor (todas as strings)
`EMAIL`, `PHONE_BR`, `CPF`, `CNPJ`, `URL` (inclui `/s/<token>`), `BEARER`, `JWT`, `LONG_SECRET` (≥ 32 caracteres aleatórios). Estrito → `PRIVACY_VIOLATION` (quarentena sem o valor); legado → propriedade removida.

## Redação
`DROP` (padrão), `BUCKET` (`privacy.bucket(312450, [...], {unit:'K'})` → `300K_350K`; `null` continua `null`), `HASH` (pseudônimo — ainda é dado pessoal), `ALLOW`. Contagens de resultado em faixas (`0`, `1`, `2_5`, `6_20`, `21_PLUS`).

## Campanha
`extractCampaign` aceita só `utm_source/medium/campaign/content/term`, normalizados e sem PII; a URL de entrada nunca é guardada. Atribuição continua sendo do `JourneyAcquisitionContext`.

## Consentimento
| Estado | Captura local (memória) | Envio remoto |
|---|---|---|
| `UNKNOWN` (padrão) | sim, eventos sem PII | não |
| `GRANTED` | sim | só se o destino estiver ligado |
| `DENIED` | não (apaga o que havia) | não |
| telemetria `NOT_REQUIRED_BY_POLICY` | sim, só local | nunca |

Revogação antes do flush: `setConsent('DENIED')` remove do buffer e da fila os eventos dependentes de consentimento. `UNKNOWN` depois de `GRANTED` esvazia a fila remota. Não há envio retroativo.

## Decisões humanas
D1 (base legal da captura local), D3 (terceiros), D5 (ID anônimo persistente), D7 (retenção). Ver `policy.json → decisions`.
