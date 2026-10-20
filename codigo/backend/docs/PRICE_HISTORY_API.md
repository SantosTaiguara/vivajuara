# API de histórico de preço de tabela (tópico 28)

Status: implementado (API 1.3.0), somente leitura. Metodologia `price-history-1.0`.

## 1. Fonte e lacuna do tópico 27

O histórico é um **modelo de leitura derivado** das versões publicadas de tabela de preço. Vale:

- `price_tables` com status `PUBLISHED` (corrente) ou `ARCHIVED` (anteriores);
- `lot_prices` de cada versão.

Essas versões são imutáveis desde a migração 005. Rascunhos (`DRAFT`) e dry-runs nunca entram.

O tópico 27 (modelo canônico de versões de preço) **não foi fornecido**. Por isso foi reaproveitado o modelo da migração 005: `version`, `valid_from`, `valid_until`, `issued_on`, `published_at`, `archived_at`, `checksum`, `pricing_mode` e `change_reason`. Quando o tópico 27 existir, só o repositório (`priceHistory.repository.js`) precisa mudar; o domínio é puro.

Hoje o `viva-juara` tem **uma única versão** (R$ 1.196/m², 2026-10-06). Por isso toda variação sai `null` com motivo.

## 2. Endpoints

| Método | Rota | Permissão | Schema |
|---|---|---|---|
| GET | `/api/v1/developments/{developmentId}/lots/{lotId}/price-history` | `lot.price_history.view` (pública em empreendimento PUBLIC) | `LotPriceHistoryResponse` |
| GET | `/api/v1/developments/{developmentId}/pricing/history` | `lot.price_history.view` | `DevelopmentPriceHistoryResponse` |

- Não aceitam parâmetros de query (400 em qualquer parâmetro).
- Sem métodos de escrita.
- ETag derivada do ponteiro da tabela corrente + checksums das versões: muda a cada publicação, e versões fechadas nunca mudam.
- Lote inexistente ou de outro empreendimento → 404 `LOT_NOT_FOUND`. Empreendimento inexistente ou invisível → 404 `DEVELOPMENT_NOT_FOUND`.

## 3. Regras

1. **Um ponto por versão publicada**, em ordem de `effectiveFrom` = `valid_from` → `issued_on` → data de publicação. Desempate por publicação e depois id. `effectiveTo` = `valid_until` ou início da versão seguinte.
2. **Série em degraus, sem interpolação.** Cada intervalo carrega só o valor da própria versão.
3. **Lacuna não é zero.** Versão sem preço para o lote → ponto `MISSING` e evento `REMOVED`, nunca queda. Ao voltar o preço, o evento é `RESTORED`, sem delta através da lacuna.
4. **Variação só com ≥ 2 pontos comparáveis** (`VALID`, mesmo `priceType = LIST_PRICE` e mesma moeda). Caso contrário, `absoluteChange` e `relativeChangePct` são `null` e `notCalculableReason` é:
   - `NO_VALID_PRICE`;
   - `INSUFFICIENT_COMPARABLE_VERSIONS`;
   - `ZERO_START_PRICE` (só o percentual fica nulo).
5. Moeda diferente → ponto `NOT_APPLICABLE`, excluído da série (aviso `MIXED_CURRENCY_EXCLUDED`). Valor negativo → `INVALID`.
6. **Motivo nunca inferido**: `reason = UNKNOWN_REASON`. `reasonText` só repete a nota informada na publicação (`changeReason`).
7. **Qualidade**: `HIGH` (≥ 2 pontos, cobertura 100%), `MEDIUM` (≥ 50%), `LOW` e `INSUFFICIENT` (nenhum ponto válido).
8. **Visão do empreendimento**: índice interno dos preços de tabela, não um índice de mercado.
   - Por versão: mediana de preço e de R$/m² e cobertura.
   - Entre versões: **cesta dos mesmos lotes** (`SAME_LOT_BASKET_MEDIAN`), com mediana da variação percentual e contagens de alta, queda e sem mudança. Lotes que entram ou saem não distorcem a variação.

## 4. Linguagem

Rótulos fixos:

- "Variação do preço de tabela (nominal)";
- "Índice interno dos preços de tabela do empreendimento — não é índice de mercado nem valorização do ativo".

`caveats` acompanham toda resposta e dizem explicitamente que **não** se trata de valorização do ativo, rentabilidade ou retorno, nem de tendência futura. É proibido usar estes termos para descrever o histórico.

## 5. Exemplo (viva-juara hoje, resumido)

```json
{ "data": { "lotId": "VJ-QB-L0079", "priceType": "LIST_PRICE", "points": [{ "priceTableId": "lancamento-2026-10", "pricePerM2": 1196, "pointStatus": "VALID" }],
  "summary": { "comparableVersionCount": 1, "absoluteChange": null, "relativeChangePct": null, "calculationStatus": "NOT_CALCULABLE",
               "notCalculableReason": "INSUFFICIENT_COMPARABLE_VERSIONS", "label": "Variação do preço de tabela (nominal)" },
  "quality": { "level": "LOW" }, "caveats": ["..."] } }
```

## 6. Não implementado (documentado)

- CAGR ou taxa anualizada; ajuste por inflação.
- Série promocional (não existe tipo de preço promocional).
- Consulta `asOfKnowledgeDate` (o que se sabia em uma data).
- Preços de transação (não há dados de venda).
- Paginação ou filtro de período: desnecessário com poucas versões.

## 7. Testes

`tests/priceHistory.test.js`:

- **Domínio puro:** versão única, alta, queda, sem mudança, lacuna, preço inicial zero, moeda diferente, cesta do empreendimento, linguagem e pureza.
- **Banco:** estado atual não calculável; publicação de segunda versão calcula a variação, mantém a anterior `ARCHIVED` e intacta, e troca a ETag.
