# Resposta a incidentes de privacidade

> Gerado por `node scripts/privacyDocs.js` a partir de `src/privacy/privacyWorkflow.js` e `config/privacy/lifecycle.json`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Fluxo (§252, §563): incidente de segurança → envolve dado pessoal? Não → só segurança (`SECURITY_ONLY`). Sim/incerto → PrivacyIncidentCase (ASSESSING → CONTAINING → NOTIFYING → REMEDIATING → CLOSED).

- Avaliação de risco/dano relevante (YES / NO / UNCERTAIN) com responsável e data.
- Prazos de comunicação vêm do PrivacyDeadlineRegistry (`INCIDENT_NOTIFICATION_ANPD`, `INCIDENT_NOTIFICATION_SUBJECTS`), contados da ciência do controlador. Hoje `businessDays = null` → NOT_CONFIGURED, com a referência da especificação (3 dias úteis, Res. CD/ANPD nº 15/2024) exibida para o jurídico validar. Sem calendário de feriados: só fins de semana são pulados e o resultado avisa HOLIDAYS_NOT_CONFIGURED.
- Comunicação preliminar e complementar; evidência guarda checksum do conteúdo, canal, escopo e data (não copia o conjunto vazado, §254).
- Não fecha com decisão pendente nem sem evidência quando a comunicação é exigida.
- Comunicação pública só pelo comando do incidente (§253). Exercício de mesa: a agendar.
