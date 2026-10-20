# Relatório de cobertura de proveniência (Tópico 33)

Estado operacional após a migração (`coverage`, `manifest`, `diagnostics`; 2026-10-09). **Não é score de confiança.**

| Indicador | Valor |
|---|---|
| Entidades (lotes) | 498 |
| Atributos rastreados no registro | 134 |
| Registros | 66.732 (cobertura 100% dos atributos rastreados) |
| VERIFIED / PARTIAL / UNRESOLVED / MISSING | 1.992 / 44.471 / 4.333 / 15.936 |
| Em revisão (status ou currentness) | 3.682 |
| LEGACY_DECLARED | 18.533 |
| Conflitos abertos | 0 |
| Referências quebradas (documento / dependência) | 0 / 0 |
| Divergência de fingerprint vs. valor canônico | 0 |

Por tipo: CALCULATED 10.351 · LEGACY_DECLARED 18.533 · DIRECT_SOURCE 3.984 · NOT_AVAILABLE 15.438 · ESTIMATED 9.462 · ANALYSIS_DERIVED 8.964.

Por rótulo exibível: Calculado 11.845 · Legado/Informado 18.337 · Confirmado 1.992 · Informado (parcial) 1.992 · Não disponível 15.438 ·
Estimado 16.932 · Revisar 196.

Por domínio (registros / verificados): IDENTITY 3.984/498 · GEOMETRY 10.458/0 · LOCATION 7.968/0 · SURROUNDINGS 5.976/0 · MOBILITY 3.486/0 ·
ENVIRONMENTAL 8.964/0 · CONSTRUCTION 6.972/498 · COMMERCIAL 4.980/0 · INTELLIGENCE 8.964/498 · AVAILABILITY 4.482/498.

Leitura: a base é majoritariamente **rastreável em parte** (métodos e versões conhecidos) mas quase nada tem a fonte exata verificada,
porque os documentos de origem ainda não foram publicados na plataforma. O caminho de maior ganho é publicar a planta oficial.

Reprodução: `App.provenanceMigration.load(svc, tenant, lots, 'viva-juara')` → `svc.coverage(tenant, 'viva-juara')`.
