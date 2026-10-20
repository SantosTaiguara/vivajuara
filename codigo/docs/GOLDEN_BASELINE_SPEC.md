# Especificação do golden baseline

## Objeto

```ts
interface GoldenBaseline {               // tests/golden/baseline.json
  baselineId: 'golden-viva-juara-2026-10-11';
  createdAt: '2026-10-11T12:00:00-03:00'; // = relógio fixo da captura
  appVersion: string;                     // build de plat/src (tópicos 1–56)
  datasetVersion: '2026-10-06.1|2026-10-06|2026-10-06'; // static|analysis|priceTable
  developmentId: 'viva-juara';
  lotCount: 498;                          // só nesta fixture; nunca no código da plataforma
  fixtureRefs: string[];                  // tests/golden/<categoria>.golden.json (13)
  categoryFingerprints: Record<string, string>; // sha256 do JSON canônico de cada categoria
  knownExceptions: string[];
}
```

## Captura

- Código: `src/governance/goldenBaseline.js` (`App.governance.golden.capture`), puro, roda os **módulos reais** (repositório, motor, filtros, camadas, legenda, geo, QuickView, view models, finance, solar, busca) sobre `dash/*.json`, no harness Node com **relógio fixo** (`config/governance/golden.json` → `fixedClock`).
- Script: `node scripts/goldenBaseline.js` compara e imprime as diferenças; `--update` regrava (somente com registro em `LEGACY_PARITY_EXCEPTIONS.md`).
- Fixture de entrada: `config/governance/golden.json` — 21 lotes representativos (esquina, interno, perto da portaria/clube, área verde nos fundos, formatos irregular/trapezoidal, preços e scores extremos, classes A+…D, sem alertas, com servidão/área técnica/restrição, as 8 orientações), 28 cenários de filtro, 3 perfis de recomendação, 4 cenários financeiros, 3 estações × 3 horários, 10 consultas de busca, 3 conjuntos de share, 2 de comparação.
- JSON canônico: chaves ordenadas; `Map` → objeto, `Set` → lista ordenada (seguro entre realms do `vm`); floats de trigonometria/finanças arredondados a 1e-6 (precisão de cálculo, não de exibição).
- Arquivo: uma entrada de primeiro nível por linha (um lote, uma camada, um cenário por linha) para diffs revisáveis.

## Categorias

`dataset` · `lots` · `map` · `layers` · `filters` · `recommendations` · `finance` · `solar` · `quickview` · `share` · `comparison` · `search` · `texts`. Conteúdo de cada uma: [GOLDEN_TEST_MATRIX.md](GOLDEN_TEST_MATRIX.md).

## O que fica de fora (de propósito)

Ações e layout do QuickView, navegação/menu (tópico 53), módulos em andamento dos tópicos 49–51, 53 e 56 nesta rodada: o golden fotografa **dados e saídas calculadas**, não UI em evolução. Screenshots ficam na política visual (`VISUAL_REGRESSION_POLICY.md`).

## Verificação (`tests/preservation54.test.js`)

1. Integridade: o sha256 de cada arquivo golden = `categoryFingerprints` (fixture editada à mão é detectada).
2. Paridade: a captura atual é comparada categoria por categoria; **qualquer** diferença falha, exceto as cobertas por ParityException aprovada (`capabilities.json` → `parityExceptions`, casadas por `pathPattern`).
3. Invariantes explícitas da fixture: 498 lotes, IDs únicos, 498 UNKNOWN, `status-available = 0`, `only-offerable = 0`, recomendação real vazia, R$ 1.196/m², preço = área × 1.196, todo ponto de rótulo acerta o próprio lote, texto de share sem "Disponível" e com rodapé, modo cliente sem score.
4. Determinismo: duas capturas em harnesses novos dão os mesmos fingerprints.
5. Não vacuidade: alterar 1 centavo, 1 cor ou 1 palavra é detectado com o caminho exato.

## Cenário sintético

`recommendations.engine["synthetic:*"]` roda o mesmo motor sobre uma cópia em memória com todos os status `AVAILABLE`, para exercitar o ranking. É fixture de teste: nunca exibida, nunca gravada nos dados (os testes existentes fazem o mesmo com `withStatus`).
