# Ciclo de vida e reconciliação dos alertas (Tópico 36)

`AlertStore.reconcile(evaluations, { rules, now, mode })` recebe `{ result, candidate }` de uma rodada coerente.

| Entrada | Instância | Ação |
|---|---|---|
| TRUE, sem instância | — | cria ACTIVE, episódio 1, evento `ALERT_OPENED` |
| TRUE, mesma impressão digital | ativa | nada (sem spam), `UNCHANGED` |
| TRUE, severidade diferente | ativa | atualiza a mesma instância, evento `ALERT_SEVERITY_CHANGED` (from/to) |
| TRUE | RESOLVED | reabre (`reopenWhenTrue`), novo episódio, reconhecimento anterior limpo (salvo `preserveAcknowledgementOnRetrigger`), `ALERT_REOPENED` (marcado `suppressed` dentro do cooldown) |
| TRUE | DISMISSED | mantém descartado enquanto a condição continuar |
| FALSE | ativa | resolve (`autoResolveWhenFalse`), fecha o episódio, `ALERT_RESOLVED`; se a política exigir, `MANUAL_RESOLUTION_REQUIRED` |
| UNKNOWN | ativa | mantém (desconhecido não é "condição sumiu") |
| ERROR / NOT_APPLICABLE | qualquer | ignorado: falha técnica não abre nem resolve alerta de negócio |
| qualquer | modo REPLAY | nada muda (`mutated: false`) |

**Histerese** (`hysteresisPolicy`): `parameterKey` + `activationThreshold`/`resolutionThreshold` (o motor recebe `activeState` e usa o limite de resolução quando o alerta está ativo), `activationConsecutiveEvaluations`, `resolutionConsecutiveEvaluations`, `minimumActiveDurationSeconds`.

**Supressão** (`suppressionPolicy`): impressão digital repetida não gera evento; `cooldownSeconds` marca reaberturas próximas como suprimidas. Supressão nunca muda a verdade da regra.

**Ações** (todas exigem permissão injetada `can(perm)` — negar por padrão —, recusam escrita offline e aceitam `expectedVersion`):
- `acknowledge` (`alert.acknowledge`): idempotente; não resolve; vale para o episódio.
- `snooze` (`alert.snooze`): exige `until`; `expireSnoozes(now)` devolve ao estado anterior (o agendador é trabalho futuro).
- `dismiss` (`alert.dismiss`): exige motivo; proibido para CRITICAL salvo política; não muda o dado do lote.

Notificação (WhatsApp/e-mail/push) não existe neste tópico: `store.events()` / `drainEvents()` são o gancho para um assinante futuro.
