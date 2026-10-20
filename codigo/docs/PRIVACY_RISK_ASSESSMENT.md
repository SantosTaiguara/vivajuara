# Avaliação de risco de privacidade

> Gerado por `node scripts/privacyDocs.js` a partir de arquivos do tópico 59. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Dimensões (§145): acesso indevido, coleta excessiva, uso inesperado, discriminação, dano financeiro, roubo de identidade, perda de confidencialidade, impacto de perfilamento, exposição, retenção excessiva.

Riscos atuais identificados no código:

| Risco | Onde | Severidade | Mitigação existente | Pendente |
|---|---|---|---|---|
| Nomes/orçamentos de clientes no navegador | ws:<dev>:state | Média | nada sai do aparelho; Central de privacidade apaga | D59-1 |
| Nome do cliente na URL do WhatsApp | services/share.js | Média | campo opcional | D59-2 |
| IP do visitante para Google Fonts | página | Baixa | no-referrer | D50-3 |
| Aparelho perdido com clientes de trabalho | localStorage | Média | sem CPF/documentos/notas no navegador | política de dispositivo |
| Notas livres com dado sensível | journey/decision (memória) | Média | aviso, RESTRICTED, nunca persistido | revisão de notas |
| Login Google sem região/mecanismo | backend auth | Baixa | só hashes | avaliação de transferência |

Nenhuma `PrivacyRiskAssessment` formal aprovada; o modelo está em RIPD_MODEL.
