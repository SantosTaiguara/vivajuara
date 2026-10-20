# Checklist de remoção do legado

Para cada componente de `LEGACY_SUNSET_PLAN.md`, antes de apagar:

- [ ] O substituto está em NEW_ONLY há uma janela de estabilização adequada ao uso (uso diário: ao menos 2 semanas de uso real; uso raro: um ciclo completo do fluxo).
- [ ] Golden sem diferença com o legado desligado (ou exceções aprovadas).
- [ ] Métrica de fallback = 0 na janela.
- [ ] Nenhuma referência restante (`grep` do namespace/arquivo; teste de arquitetura sem achado novo).
- [ ] Dados de usuário preservados ou migrados (favoritos, preferências de layout, links antigos — ver `STATE_CONTINUITY_MATRIX.md`).
- [ ] Links/rotas antigas redirecionam ou degradam com aviso (`LEGACY_ROUTE_MIGRATION_REPORT.md`).
- [ ] Flag de migração removida junto.
- [ ] Documentação atualizada (`ARCHITECTURE.md`, matriz de preservação: status `NEW_ONLY` → `LEGACY_REMOVED`).
- [ ] Nota de release ("movido para…" quando for o caso).
- [ ] Rollback considerado: o artefato anterior continua disponível pelo período combinado.
- [ ] Signoff para P0.
