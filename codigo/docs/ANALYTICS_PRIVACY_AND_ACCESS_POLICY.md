# Privacidade e acesso em analytics (tópico 44)

## Dados
- Métricas leem somente envelopes já higienizados pelo tópico 45 (sem telefone, e-mail, CPF, token, URL completa, busca livre, orçamento exato).
- Nenhuma métrica, dimensão ou fato usa preço de lote, valor de orçamento, nome ou contato de cliente.
- Dimensões sensíveis (`ownerUserId`, `customerSegment`) têm supressão de grupos pequenos (mínimo 5).
- Agregados não guardam identificadores de evento nem de usuário; guardam código, versão, período, valor, numerador, denominador, qualidade e watermark.

## Acesso
- Toda consulta exige `organizationId`; dados de outra organização nunca entram (`AnalyticsCrossTenantIsolation`).
- A visão "Métricas locais" só existe no **modo Técnico** (`App.authz.uiMode('technical')`); fora dele o view model retorna `allowed = false` e nada é calculado.
- Ações da visão (`analyticsRefresh`, `analyticsRange`, `analyticsClear`) são negadas por padrão até serem registradas em `config/security/features.json`. localStorage nunca autoriza nada.
- Permissões granulares `analytics.view`, `analytics.export`, `analytics.viewSensitive` estão **propostas, não criadas** (decisão D6). Exportação não existe.

## Envio
- Nada sai do aparelho. Destinos remotos (ingestão first-party, GA, Meta) desligados (decisões D2, D3).
- "Limpar dados locais" apaga buffer, fila e quarentena da organização atual.
