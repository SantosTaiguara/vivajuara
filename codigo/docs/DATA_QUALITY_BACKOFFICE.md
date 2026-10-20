# Backoffice de qualidade (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

`App.dataQualityView.home(assessment)`: cards de saúde por domínio, tabela de findings, owners (pendentes destacados), aviso ao cliente. Só HTML escapado; navegação por `data-dq-tab` (sem `data-act`, então o painel publicado e o visitante não mudam). Ações (reconhecer, resolver, exceção, rodar checks, incidente, certificar) ficam atrás das permissões `data_quality.*`/`data_governance.*` — nenhuma concedida a role; a integração no console (tópico 60) e os data-acts dependem do coordenador.

Rotas backend (prontas, não ligadas): `/api/v1/admin/data-quality/*` e `/api/v1/admin/data-governance/*` (14 rotas, ver `dataquality.controller.js`).
