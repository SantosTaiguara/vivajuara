# Ciclo de atualização (PwaUpdateCoordinator)

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

Estados: UP_TO_DATE · CHECKING · UPDATE_AVAILABLE · ACTIVATION_PENDING · ACTIVATING · RELOAD_REQUIRED · UPDATE_FAILED.

Política padrão (`PwaUpdatePolicy`): `autoActivate: NEVER`, `requireUserConfirmationForBreakingUpdate: true`, `allowDeferredActivation: true`, verificação automática no máximo 1×/h (início) e 6 h (volta ao primeiro plano); manual sempre.

```text
novo worker instalado → WAITING → UPDATE_AVAILABLE ("Nova versão disponível." [Atualizar agora] [Depois])
  usuário confirma → bloqueios?  proposta / edição de cliente / passo de apresentação / simulação não salva
                                 / fila offline com esquema incompatível
     sim → ACTIVATION_PENDING ("Atualização pronta. Ela será aplicada quando você concluir …") → aplica quando o app avisar activityChanged()
     não → salva estado seguro → SKIP_WAITING → controllerchange → RELOAD (uma vez)
  sem controllerchange em 10 s → UPDATE_FAILED ("A versão atual continua funcionando.")
```

## Compatibilidade de versões (§46, §47, §213)
A página conhece `appBuildId` (meta app-build-id) e as versões de esquema (`App.pwa.core.VERSIONS`); o worker responde `GET_VERSION`.
- MATCH: mesmo build. TOLERATED: builds diferentes, mesmos esquemas (o worker só roteia; atualização oferecida).
- UPDATE_REQUIRED: cacheSchemaVersion, apiCompatibilityVersion ou offlinePackSchemaVersion diferem → RELOAD_REQUIRED ("Atualização requer reinício.").
- Outra aba ativou um worker novo → esta aba vê RELOAD_REQUIRED.

## Fila pendente (§217–§219, §369)
A atualização nunca apaga a fila. Esquema compatível → preservada. Esquema diferente → bloqueio QUEUE_SCHEMA_INCOMPATIBLE até sincronizar.

## Dados × código (§35, §36)
Atualizar o código troca só o shell; pacotes, AssetCache e IndexedDB permanecem. Publicar dados novos não invalida o shell.

## Verificado no navegador
`tests/pwa.e2e.js`: build A → build B, worker B espera, o worker A continua controlando, o usuário aceita, uma recarga, shell A apagado, pacote e dados preservados, boot offline com o shell B.
