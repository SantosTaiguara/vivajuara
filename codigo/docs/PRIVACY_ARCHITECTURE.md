# Arquitetura de privacidade (tópico 59)

> Gerado por `node scripts/privacyDocs.js` a partir de arquivos do tópico 59. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

## Módulos

| Camada | Arquivo | Papel |
|---|---|---|
| Registros (dados) | `config/privacy/registries.json`, `lifecycle.json`, `thirdParties.json`, `governance.json`, `policies.json` | Inventário, finalidades, bases (null), retenção (null), prazos (null), fornecedores, transferências, encarregado, políticas técnicas |
| Domínio (puro) | `src/privacy/privacyCore.js` (`App.privacy.core`) | PrivacyPolicyService: mayProcess/mayCollect/mayPersist/mayShare/mayExport, capability, mascaramento, logs, PII em URL, analytics, projeção client-safe, allowlists, change gate, exceções, blockers, maturidade |
| Fluxos (puro) | `src/privacy/privacyWorkflow.js` (`App.privacy.workflow`) | Avisos, consentimento, preferências e supressão, solicitações do titular, verificação, descoberta, pacote de acesso, correção, eliminação, legal hold, bloqueio, tombstones, retenção, fornecedores, incidentes, métricas |
| Aparelho | `src/privacy/deviceData.js` (`App.privacy.device`) | Inventário do navegador, varredura, exportação e eliminação local |
| UI | `src/privacy/privacyView.js` (`App.privacyView`) | Central de privacidade, confirmação, painel de governança, sinal de contato, aviso em notas |
| Backend | `backend/src/modules/privacy/*` + migração 013 | Mesmo domínio (carregado do `plat/src`), serviço com repositórios (memória e Postgres), rotas `/api/v1/privacy/*` (não ligadas ao router ainda) |

## Decisão final de acesso (§482)

Autenticado? → organização? → permissão? → escopo? → política de privacidade (finalidade, base aprovada, consentimento quando é a base, fronteira de categoria) → bloqueio / legal hold / tombstone. Negação mostra "Não disponível" (não revela existência).

## Invariantes (§568)

Sem finalidade → sem coleta. Sem base aprovada → sem tratamento. Sem revisão de fornecedor → sem compartilhamento. Sem mecanismo → sem transferência. Consentimento revogado → para o tratamento baseado nele. Legal hold → só para a finalidade do hold. Eliminação → propaga e deixa tombstone. Dado pessoal nunca em URL pública (exceção existente: LPF_SHARE_NAME_IN_URL). Dado sensível nunca é critério de recomendação. Share de cliente = projeção mínima. PII de produção não é dado de teste (testes usam só fixtures sintéticas). Incidente de segurança → avaliação de privacidade.

## Maturidade

Hoje **L1** (inventário e classificação). L2 depende do jurídico aprovar bases e retenção; L3 depende de fornecedores revisados, encarregado e backend ligado.
