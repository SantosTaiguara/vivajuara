# Inventário de comportamentos legados

Bug não é força: comportamento classificado como BUG não entra no golden como verdade obrigatória sem uma ParityException. Fonte máquina-legível: `capabilities.json` → `knownLegacyBehaviors` (KLB-01…05); as linhas sem ID abaixo são achados desta rodada ainda não promovidos ao registro.

| ID | Capacidade | Comportamento | Classe | Evidência | Tratamento |
|---|---|---|---|---|---|
| KLB-01 | CAP-26 | os 498 lotes estão UNKNOWN ("Status não confirmado"); nada é ofertável nem recomendável | INTENDED | `dataset.availabilityStatusCounts`, golden `recommendations.engine.*.recommended = 0` | preservar até existir espelho de vendas |
| KLB-02 | CAP-16 | simulação sem correção pelo IGP-M; rodapé "Valores sem correção pelo IGP-M…" | INTENDED | `texts.share.footer` | preservar |
| KLB-03 | CAP-14 | empates de relevância nos presets seguem a ordem do dataset (ex.: O5, O6, O8 = 0,92) | AMBIGUOUS | golden `recommendations.legacyPresets` | determinístico; critério de desempate a confirmar com o negócio |
| KLB-04 | CAP-15 | cálculo solar astronômico sem sombra de vizinhos | INTENDED | nota da camada "Sol agora" | preservar a nota |
| KLB-05 | CAP-11 | `App.analytics` instalado duas vezes (stub do store, depois fachada) | BUG (sem efeito visível) | GAP-ARCH-10 | corrigir na fase 7.6 |
| — | CAP-27 | fórmula do preço repetida em 4 arquivos (mesmo resultado) | INTENDED (resultado) / dívida (forma) | `LEGACY_FORMULA_INVENTORY.md`, TD-12 | unificar sem mudar valor |
| — | CAP-10 | 7 campos com valores vazios sem motivo registrado (3.486 valores); zeros de geometria em 5 lotes | UNVERIFIED | `RELATORIO_TOPICOS_32_42.md` §7 | decisão humana; não corrigir no golden |
| — | CAP-28 | alerta "área ausente" com texto a corrigir (motor de regras desligado) | AMBIGUOUS | `RELATORIO_TOPICOS_32_42.md` §1 | D-ALERTS; mudança de texto = exceção aprovada |
| — | CAP-19 | texto do WhatsApp leva nome do cliente, preço e status na URL wa.me | AMBIGUOUS (privacidade) | golden `share` | D-WHATSAPP-TEXT; correção de segurança pode quebrar paridade (exceção SECURITY_FIX) |
| — | CAP-11 | `DataStatus.UNKNOWN` é exibido como "Não disponível" (não há código `NOT_AVAILABLE`) | INTENDED | golden `texts.dataStatus` | preservar o rótulo |

Inventário por módulo (capacidade, implementação, dados, entradas da UI, fórmulas, storage, efeitos colaterais, bugs, saídas esperadas): ver `CAPABILITY_PRESERVATION_MATRIX.md` (localização e regressões proibidas), `LEGACY_FORMULA_INVENTORY.md` (fórmulas), `CURRENT_ARCHITECTURE_INVENTORY.md` (storage, rede, DOM por arquivo) e o golden (saídas esperadas).
