# Fluxo de solicitações do titular

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/lifecycle.json` (deadlineRules, requestRisk) e `config/privacy/governance.json` (denialReasons). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Na interface do corretor: "Solicitação do titular" (nunca "DSAR").

Estados: RECEIVED → IDENTITY_VERIFICATION → IN_REVIEW → ACTION_REQUIRED → COMPLETED → PARTIALLY_COMPLETED → DENIED_WITH_REASON → CANCELLED.

| De | Para |
|---|---|
| RECEIVED | IDENTITY_VERIFICATION, CANCELLED, DENIED_WITH_REASON |
| IDENTITY_VERIFICATION | IN_REVIEW (só com verificação VERIFIED), DENIED_WITH_REASON, CANCELLED |
| IN_REVIEW | ACTION_REQUIRED, COMPLETED, PARTIALLY_COMPLETED, DENIED_WITH_REASON, CANCELLED |
| ACTION_REQUIRED | IN_REVIEW, COMPLETED, PARTIALLY_COMPLETED, DENIED_WITH_REASON, CANCELLED |

Regras: `subjectRef` é id opaco (e-mail/telefone/CPF recusados); revisão otimista (`REVISION_CONFLICT`); outra organização recebe `NOT_FOUND`; recusa exige motivo do registro versionado; trilha RECEIVED/verificado/SEARCHED/resolvido; descoberta por `SubjectDataLocator` de cada domínio; pacote de acesso com checksum, dados de terceiros excluídos e nomes de outras pessoas redigidos; correção propagada por sistema; roteamento HANDLE/FORWARD/COORDINATE quando a organização é operadora (§416).

Prazos (PrivacyDeadlineRegistry): `null` → `dueAt = null`, `deadlineStatus = NOT_CONFIGURED`.

| Regra | Tipo | Dias úteis | Dias corridos | Referência | Risco | Status |
|---|---|---|---|---|---|---|
| DSR_CONFIRM_PROCESSING | CONFIRM_PROCESSING | — (necessita validação) | — (necessita validação) | LGPD art. 18, I e art. 19 — prazo a validar pelo jurídico | LOW | NECESSITA_VALIDACAO_JURIDICA |
| DSR_ACCESS | ACCESS | — (necessita validação) | — (necessita validação) | LGPD art. 18, II e art. 19 — prazo a validar pelo jurídico | HIGH | NECESSITA_VALIDACAO_JURIDICA |
| DSR_CORRECTION | CORRECTION | — (necessita validação) | — (necessita validação) | LGPD art. 18, III | MEDIUM | NECESSITA_VALIDACAO_JURIDICA |
| DSR_ANONYMIZATION | ANONYMIZATION | — (necessita validação) | — (necessita validação) | LGPD art. 18, IV | HIGH | NECESSITA_VALIDACAO_JURIDICA |
| DSR_BLOCKING | BLOCKING | — (necessita validação) | — (necessita validação) | LGPD art. 18, IV | MEDIUM | NECESSITA_VALIDACAO_JURIDICA |
| DSR_DELETION | DELETION | — (necessita validação) | — (necessita validação) | LGPD art. 18, IV e VI; art. 16 | HIGH | NECESSITA_VALIDACAO_JURIDICA |
| DSR_PORTABILITY | PORTABILITY | — (necessita validação) | — (necessita validação) | LGPD art. 18, V (regulamentação ANPD) | HIGH | NECESSITA_VALIDACAO_JURIDICA |
| DSR_SHARING_INFORMATION | SHARING_INFORMATION | — (necessita validação) | — (necessita validação) | LGPD art. 18, VII | MEDIUM | NECESSITA_VALIDACAO_JURIDICA |
| DSR_CONSENT_INFORMATION | CONSENT_INFORMATION | — (necessita validação) | — (necessita validação) | LGPD art. 18, VIII | LOW | NECESSITA_VALIDACAO_JURIDICA |
| DSR_CONSENT_WITHDRAWAL | CONSENT_WITHDRAWAL | — (necessita validação) | — (necessita validação) | LGPD art. 18, IX; art. 8º §5º | LOW | NECESSITA_VALIDACAO_JURIDICA |
| DSR_OBJECTION | OBJECTION | — (necessita validação) | — (necessita validação) | LGPD art. 18 §2º | MEDIUM | NECESSITA_VALIDACAO_JURIDICA |
| DSR_AUTOMATED_DECISION_REVIEW | AUTOMATED_DECISION_REVIEW | — (necessita validação) | — (necessita validação) | LGPD art. 20 | MEDIUM | NECESSITA_VALIDACAO_JURIDICA |
| DSR_OTHER | OTHER | — (necessita validação) | — (necessita validação) | a definir | MEDIUM | NECESSITA_VALIDACAO_JURIDICA |
| INCIDENT_NOTIFICATION_ANPD | INCIDENT_AUTHORITY | — (necessita validação) | — (necessita validação) | Resolução CD/ANPD nº 15/2024 |  | NECESSITA_VALIDACAO_JURIDICA |
| INCIDENT_NOTIFICATION_SUBJECTS | INCIDENT_SUBJECTS | — (necessita validação) | — (necessita validação) | Resolução CD/ANPD nº 15/2024 |  | NECESSITA_VALIDACAO_JURIDICA |

Motivos de recusa: `IDENTITY_NOT_VERIFIED` (Não foi possível confirmar a identidade do solicitante.); `NOT_THE_CONTROLLER` (A organização não é a controladora deste tratamento; o pedido foi encaminhado.); `LEGAL_RETENTION_REQUIRED` (Parte dos dados precisa ser mantida por obrigação legal ou defesa de direitos.); `THIRD_PARTY_DATA` (O pedido envolve dados de outras pessoas.); `NO_DATA_FOUND` (Não encontramos dados pessoais seus nos sistemas pesquisados.); `DUPLICATE_REQUEST` (Pedido igual já está em andamento.).
