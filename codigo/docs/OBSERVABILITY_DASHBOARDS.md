# Painéis de observabilidade

Os painéis de servidor são contratos (`registry.dashboards`), para o provedor escolhido em O1. No aparelho existe um painel técnico local: "Saúde da plataforma".

| Painel | Conteúdo | Dono |
|---|---|---|
| DASH-PLATFORM — Visão geral | taxa de requisições, erros, latência p50/p95/p99, falhas de job, pool do banco, health checks, marcadores de deploy | backend-api |
| DASH-MAP — Experiência do mapa | mapa interativo p50/p95, geometria, troca de camada, QuickView, erros do frontend, LCP, tarefas longas, por classe de dispositivo | frontend-mapa |
| DASH-COMMERCIAL — Serviços comerciais | transições e atraso de disponibilidade, publicações de preço, atualidade dos dados, negações de link | dados-comercial |
| DASH-PIPELINES — Pipelines | análise, documentos, analytics, regras, fila, dead letter | backend-jobs |
| DASH-PWA — PWA/offline | ciclo do SW, pendências e falhas de sync, conectividade, corrupção e stale de cache | frontend-pwa |
| DASH-SECURITY — Segurança | negações por grupo de permissão, violações de escopo, rate limit, negações de link | seguranca |

Regras: todo painel tem dono; organização só como filtro de consulta (drill-down), nunca label global; dashboards com RBAC (suporte vê diagnóstico operacional, não logs de segurança nem contexto de cliente).

## "Saúde da plataforma" (modo Técnico, este aparelho)

Seções: estado agora (live, ready, conectividade, dependências), atualidade dos dados, desempenho (TTFB, DOMContentLoaded, mapa interativo, montagem do mapa, primeiro desenho, troca de camada p95, clique p95, QuickView p95, LCP, INP, CLS, tarefas longas — cada um com rótulo confirmado/calculado/estimado/não disponível), erros agrupados com código de suporte, alertas operacionais locais, SLOs propostos, telemetria local (buffers, descartes, destinos), mudanças operacionais e decisões em aberto. Botões: Atualizar (`obsRefresh`), Copiar diagnóstico técnico (`obsCopyDiagnostic`), Limpar diagnóstico desta aba (`obsClear`).

## Monitoramento sintético (contrato, `registry.syntheticChecks`)

SYN-LOGIN-PAGE, SYN-MAP-BOOTSTRAP (manifesto e checksum), SYN-PUBLIC-SHARE (link de teste), SYN-HEALTH (/health/live e /health/ready), SYN-JOURNEY (login sintético → empreendimento → mapa → QuickView de lote conhecido). Usuário de teste controlado, nunca cliente real. Alerta `synthetic_journey_failing` após 3 falhas seguidas.
