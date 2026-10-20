# Relatório — Tópico 40 (Jornada do Cliente)

## Entregue
- `src/journey/journeyDomain.js`: CustomerJourney, lifecycle macro, tipos, modelo de etapas versionado (publicado congelado + checksum, rascunho, validação, impacto, plano de migração), grafo de transições (88), transição atômica com revisão esperada e override auditado, eventos append-only com registro de tipos (32) e política de ingestão (19 fontes, ruído de UI ignorado), deduplicação/coalescência, sugestões de etapa e ação (automação desligada), touchpoints sem conteúdo bruto, aquisição (first touch imutável, UNKNOWN), next actions com estado derivado, atenção e aging por etapa, pausa/retomada, resultado WON/LOST explícito com motivos, artifact links por referência, timeline projetada (ordem por occurredAt, correções, visibilidade, cursor), resumo/board/query, decisão de acesso, mapeamento de etapa de CRM e conflitos, migração legada sem histórico fabricado.
- `src/journey/journeyServices.js`: store em memória por organização, repositório com compare-and-set, serviços separados (application, stage, outcome, timeline, nextAction, ingestion, attribution, crm, board) com auditoria sem PII.
- `config/journey/policy.json` (modelo V1, eventos, ingestão, motivos, origens, políticas); docs `JOURNEY_*.md` e `CUSTOMER_JOURNEY_DOMAIN_ARCHITECTURE.md` (9).
- Testes: `tests/journey.test.js` — 18 testes, 21 cenários dourados.

## Achados
Não existe pipeline, follow-up, origem ou histórico comercial no código (ver `JOURNEY_LEGACY_PIPELINE_MIGRATION_REPORT.md`); o modelo V1 é o template do spec, a validar.

## Garantias
Jornada nunca altera lote, disponibilidade (498 UNKNOWN), preço, score, Fit ou Recommendation; nunca promete valorização; não marca WON por favorito/recomendação/reserva; não move etapa sozinha; sem last-write-wins; sem transição offline; sem notificações; sem analytics.

## Limitações
Backend não implementado (contratos/tabelas documentados); chaves `journey.*` não registradas → negadas (no modo estático a aba Jornada mostra "indisponível"); fila offline de touchpoint não implementada; motivo de ganho e reabertura (`journey.reopen`) não implementados (nova jornada é o caminho).

## Decisões humanas
1. Validar/ajustar o pipeline V1 (etapas, saltos permitidos, quem fecha).
2. Prazos de aging por etapa e janela de "vence em breve" (24 h).
3. Regra de atribuição primária (FIRST_TOUCH).
4. Motivos de perda/pausa/override.
5. Mapeamentos de etapa do CRM (Kenlo) e autoridade.
6. Registrar permissões `journey.*` e as ações de UI em `features.json`.
7. Política de unicidade (1 jornada ativa por cliente+empreendimento+tipo).
