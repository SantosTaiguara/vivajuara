# Política de permissões da navegação

Item aparece se **feature habilitada (flag) E tenant com entitlement E usuário autorizado**. Resolução central em `registry.accessOf` → `App.authz.feature(id, recurso)` (ou `NavigationContext.permissions` puro). Nunca `if role === …`.

| Situação | Estado |
|---|---|
| Permanentemente não autorizado (feature `deny:"hide"`) | HIDDEN |
| Feature `deny:"disable"` sem permissão | VISIBLE_DISABLED + mensagem da feature |
| Temporariamente indisponível (offline, ONLINE_REQUIRED) | VISIBLE_DISABLED + explicação |
| Sem entitlement / flag desligada / desabilitado na config | HIDDEN (sem item fantasma) |
| Requer contexto (Comparar sem candidatos) | VISIBLE_ENABLED + estado vazio útil |
| Modo PRESENTATION / SHARED | HIDDEN (navegação própria do runtime) |

## Matriz por papel (templates resolvidos em permissões)
| Papel | MAP | FIND | COMPARE | CUSTOMERS | DEVELOPMENT | Seções admin em Empreendimento |
|---|---|---|---|---|---|---|
| VIEWER | visível | visível | visível | oculto | visível | — |
| BROKER | visível | visível | visível | visível | visível | — |
| MARKETING | visível | visível | visível | oculto | visível | — |
| ANALYST | visível | visível | visível | oculto | visível | analyses |
| INVENTORY_MANAGER | visível | visível | visível | visível | visível | availability |
| PRICING_MANAGER | visível | visível | visível | visível | visível | pricing |
| COMMERCIAL_MANAGER | visível | visível | visível | visível | visível | availability, audit |
| OWNER_ADMIN | visível | visível | visível | visível | visível | analyses, availability, pricing, audit |

- Admin não é item primário. Seções Análises/Disponibilidade/Preços/Auditoria aparecem em Empreendimento só com a permissão. Plataforma (`/platform/*`) fica fora da navegação operacional.
- Revisão de permissões: `App.authz.subscribe` → `renderHeader` recalcula o menu; `onPermissionsChanged` redireciona se a rota atual deixou de ser permitida.
- Sem pisca-pisca: o cabeçalho é estático em `shell.html` com os 5 itens; o contexto público padrão autoriza os 5, então nada aparece e some no boot.
- Ações novas: `data-act="nav"` (variantes por `data-ws`) mapeadas para as mesmas features do `data-act="view"` atual.
- Feature flag `compact_navigation_v1` é só de rollout, não autorização.
