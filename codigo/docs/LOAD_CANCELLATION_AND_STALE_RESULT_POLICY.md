# Cancelamento e proteção contra resultado obsoleto (Tópico 47)

- Cada carregamento pertence a um **escopo** (`route`, `lot-panel:<lotId>`, `popover`). Fechar/substituir o escopo cancela seus interessados.
- **LoadTransaction**: ao iniciar, captura `(scope, revision, organizationId, developmentId)`. Ao concluir, se qualquer um mudou, o resultado é descartado (`CANCELLED/stale`) e **não** é aplicado na UI — evita mostrar o lote A depois de selecionar o lote B rapidamente.
- Seleção rápida (A→B→C): só o resultado de C é aplicado; A e B são cancelados ou descartados (teste "rapid selection").
- Troca de tenant/empreendimento: `switchContext` cancela tudo e invalida o in-flight; resultados de outro tenant nunca entram no cache do novo.
- Cancelamento não grava no cache: resposta parcial nunca é commitada (ver CACHE_ATOMIC_WRITE_AND_INTEGRITY.md).
- Falha após cancelamento é silenciosa (sem toast de erro para algo que o usuário abandonou).
