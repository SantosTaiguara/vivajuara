# Snapshot e Versionamento

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

## PresentationSnapshot
- Criado só com preflight sem bloqueantes (`createSnapshot(repo, def, src, ctx, req)`).
- `audience`: o único payload que a audiência recebe (blocos projetados, storyline, branding, `preparedAt`).
- Refs internas (definição, revisão, versões de política/preço/análise, autor): fora de `audience`.
- `checksum` sobre `audience`; `verify(snapshot)` detecta adulteração.
- `deepFreeze`: imutável. Não existe update; correção = novo snapshot.

## Definition
`revision` inteira; `revise(def, patch, expectedRevision)` → `REVISION_CONFLICT` se divergir. `markReady`, `archive`.

## Safety status (separado de frescor)
`safety.record/get/mark/reevaluate/onChange` — `SAFE`, `REVIEW_REQUIRED`, `REVOKED`. `REVOKED` impede abrir/iniciar; `REVIEW_REQUIRED` exige revisão humana. Mudança emite evento consumido pelo ShareService (tópico 42).

## Frescor
`freshness(snapshot, now)`: idade, `commercialDataMayBeOutdated` (limite padrão 24 h — decisão humana), texto "Apresentação preparada há N dias".

## Repositório
`createRepository()` em memória (referência). Backend: tabelas `presentation_definitions` (revision), `presentation_snapshots` (insert-only, checksum, org_id) e `presentation_sessions`.
