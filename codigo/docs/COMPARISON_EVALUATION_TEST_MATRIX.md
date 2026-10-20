# Matriz de testes — comparador (Tópicos 24–25)

Arquivo: `tests/compare.test.js` (29 testes, todos passando). Suíte completa: `cd tests && npm test`.

## Tópico 24 — domínio

| # | Cenário |
|---|---|
| 1 | 1 lote = DRAFT, 2 = READY, duplicado idempotente com mensagem, 5º = COMPARISON_LIMIT_REACHED sem remover ninguém |
| 2 | remover mantém ordem relativa; reordenar só aceita permutação; mover ±1; substituir mantém posição |
| 3 | ids desconhecidos, malformados e de outro empreendimento descartados com motivo, sem exceção |
| 4 | mudança de status e de filtro nunca remove candidato; fora do filtro sinalizado por coluna |
| 5 | troca de cliente atualiza Fit sem recriar sessão; sem cliente o Fit some (nunca 0%) e os lotes ficam |
| 6 | troca de perfil de métricas nunca muda candidatos; QUICK só Resumo; perfil cliente sem Inteligência |
| 7 | null/UNKNOWN/CONFLICTED/stale: sem "R$ 0", "Desconhecido" (nunca "Plano"), "Verificar divergência", stale sinalizado |
| 8 | snapshot registra versões, MIXED_VERSION, hash estável (ordem, perfil e contexto contam; generatedAt não) |
| 9 | serialize sem valores nem identidade do cliente; restore valida e migra v0 → v1 |
| 10 | deep link: ida e volta na gramática do router, `?compare=`, ids inválidos e >4 não quebram, outro empreendimento recusado; share sem PII |
| 11 | offline/reconexão: comercial stale mantém candidatos com aviso; depois READY na mesma sessão |
| 12 | resposta antiga nunca sobrescreve sessão nova (token + revision) |
| 13 | o domínio só lê dado canônico; não chama motor de score, Fit, nem `lots.json` |

## Tópico 25 — avaliação (fixtures douradas)

| # | Cenário |
|---|---|
| 14 | ClearLowerWinner (preço) e ClearHigherWinner (score): semântica explícita, fatos e frase pt-BR, sem "é melhor" |
| 15 | ExactTie, ToleranceTie, NoMaterialDifference |
| 16 | OrderedEnumWinner com orderMap formal; NON_ORDERED e INFORMATIONAL sem vencedor |
| 17 | ContextRequired: área, distâncias, sol, tráfego, esquina, verde sem preferência → sem vencedor |
| 18 | contexto do cliente: TargetRange (dentro → empate), preferências de área/lazer/portaria/verde; restrições não usadas |
| 19 | TargetValue e precisão: valor bruto decide, nunca o texto arredondado |
| 20 | suficiência: 1 valor válido nunca vence; parcial → corretor com ressalva, cliente suprimido |
| 21 | stale/conflito/confiança: suprimido (cliente), permitido com aviso (corretor), vencido suprimido, conflito e baixa confiança suprimidos |
| 22 | Fit: maior preferível com cliente (ressalvas), CONTEXT_REQUIRED sem cliente |
| 23 | disponibilidade: sem vencedor em GENERAL; com cliente AVAILABLE é vantagem; UNKNOWN nunca disponível |
| 24 | três candidatos e co-vencedores em quatro; empate nunca desfeito por id (ordem não muda resultado) |
| 25 | segurança: divisão por zero, unidade divergente, valor inválido, política inválida → falha fechada |
| 26 | snapshot de avaliação: versão de política, determinismo, recomputação seletiva (preço, versão de análise), filtro/camada não reavaliam |
| 27 | sem vencedor geral: nenhum campo "melhor lote", contagem só por critério, destaques deduplicados e limitados |
| 28 | ViewModel + render: semântica de tabela acessível, badge anunciado com o valor, mesma saída em qualquer largura, cliente sem jargão |
| 29 | API legada `App.services.comparison` funciona e não marca área/distância como "melhor" sem contexto |
