# Política de LOD (Tópico 46 §27–§30, §117)

- **Estado: desligado** (`App.geo.geometry.LOD_POLICY.enabled = false`). O mapa desenha sempre LOD2 (fidelidade total, igual a antes).
- **Motivo (benchmark):** 498 paths com 3.652 vértices não aparecem no perfil; o custo do pan/zoom estava no layout de texto SVG, não na geometria. Simplificar não traria ganho mensurável.
- **Níveis preparados (derivados, versionados):**
  | Nível | Zoom | Tolerância (unidades da planta) | Algoritmo |
  |---|---|---|---|
  | LOD0 | < 1,7 | 1,5 | `douglas-peucker-locked-vertices@1.0.0` |
  | LOD1 | 1,7–4 | 0,5 | idem |
  | LOD2 | ≥ 4 / selecionado | 0 | `quantize-0.1@1.0.0` (render atual) |
- **Topologia:** vértices compartilhados por 2+ lotes (113 no Viva Juara) e extremos do bbox ficam travados. Bordas compartilhadas e bounds se mantêm; arestas em "T" sem vértice comum podem divergir até a tolerância (aceitável só em zoom distante).
- **Testes:** contagem 498 preservada, ≥ 3 vértices, área > 0, bbox idêntico, vértices compartilhados preservados, LOD2 = canônico, LOD0 reduz 3.652 → ~2.450 vértices.
- **Precisão de render (RenderPrecisionPolicy):** `decimalPrecision = 1` (0,1 unidade ≈ 4,8 cm). A geometria canônica mantém a precisão da fonte.
- **Ativação futura:** só com benchmark em dataset maior (≥ 5.000 lotes) mostrando custo de raster/paint de paths.
