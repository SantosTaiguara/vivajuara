# Política de projeção da confiança na UI (Tópico 34)

`confidenceService.project(t, result, { mode, access })`. O resultado técnico é o mesmo em todos os modos; muda só o que se mostra.

| ExecutionMode | CLIENT | BROKER | TECHNICAL / AUDIT |
|---|---|---|---|
| DISABLED | nada | nada | nada |
| **SHADOW (atual)** | `visible: false` | `visible: false` (`SHADOW_MODE`) | painel completo com `confidence.technical.read`, selo "DRAFT · 0.1.0-draft · shadow" |
| TECHNICAL_ONLY | nada | nada | painel |
| PUBLISHED (+ metodologia PUBLISHED) | "Confiança alta/média/baixa" sem número nem fontes | "82/100 — Alta" | painel; AUDIT com histórico |

- DRAFT nunca chega a cliente ou corretor. Sem permissão técnica → `CONFIDENCE_ACCESS_DENIED`; outra organização → `CONFIDENCE_TENANT_MISMATCH`.
- Painel técnico: score/faixa, texto da explicação, dimensões (estado, nota, peso normalizado, contribuição, motivos), tetos aplicados,
  fatores limitantes, avisos, calibração, aviso fixo **"Índice de confiança do dado: não é probabilidade nem garantia."**
- Cor: o painel usa tokens neutros; nenhuma faixa usa verde como "garantido". Sem cor nova no mapa, sem filtro, sem camada (só após publicação).
- Acesso a evidência restrita não muda o score técnico; a explicação para cliente não cita fontes.
- Texto proibido: "Há X% de chance de ser verdadeiro".
- Acessibilidade: tabela com `caption`/`scope`, texto equivalente ao número, região rotulada.
