# Relatório de pendências: rodada de 08/10/2026

Data: 08/10/2026. Base de dados: os 498 lotes publicados. Disponibilidade: `UNKNOWN` nos 498 lotes, porque ainda não há espelho de vendas.

Esta rodada atacou os itens listados como "Não implementado / pendências" nos documentos de `plat/docs`. Este relatório resume o que foi feito, como foi verificado e o que continua pendente porque depende de dados ou de decisões do proprietário. Cada documento afetado teve sua seção de pendências atualizada: os itens resolvidos estão marcados como "Implementado em 08/10/2026", e os que continuam abertos permanecem na lista.

## 1. O que foi implementado

### 1.1 Backend (`plat/backend`)

O contrato da API passou da versão 1.1 para a 1.2.0. Todas as mudanças são aditivas: nenhum endpoint existente mudou de forma.

| Item | Como funciona |
|---|---|
| Autenticação de administrador | A escrita usa o token `ADMIN_API_TOKEN`, comparado por hash sha256 com `timingSafeEqual`. Sem o token definido, toda escrita responde 403 `WRITES_DISABLED`; com token errado, 401. A leitura continua pública. Em produção, um token com menos de 32 caracteres impede a API de iniciar. As variáveis antigas `WRITES_ENABLED` e `WRITE_API_KEY` ficaram obsoletas. |
| `Idempotency-Key` | Vale para os `POST` e `PATCH` de administrador. Repetir a mesma requisição devolve a resposta guardada, com o cabeçalho `Idempotent-Replayed`. Reusar a chave com outro corpo responde 409 `IDEMPOTENCY_KEY_REUSED`; repetir enquanto a primeira ainda está em andamento responde 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`. A chave vale 24 horas por padrão. |
| Publicação de tabela de preços | `POST /api/v1/developments/{id}/price-tables` aceita preço por m², preço por lote ou os dois. Cada publicação cria uma versão nova e imutável, arquiva a anterior (`ARCHIVED`) e grava auditoria. Com `?dryRun=true`, devolve a diferença lote a lote sem gravar nada. |
| Pré-visualização de análise | `POST /api/v1/developments/{id}/analysis/preview` roda o mesmo motor do frontend com uma metodologia candidata e devolve o relatório de impacto, sem publicar. |
| Fluxo de disponibilidade | `GET /api/v1/developments/{id}/availability/stream` envia mudanças por SSE. Usa LISTEN/NOTIFY do Postgres, com polling como alternativa, retomada por `Last-Event-ID`, heartbeat e limite de conexões (`SSE_MAX_CLIENTS`). |
| Banco e importação | Migrations 004 a 007, cada uma com script de reversão. O importador passou a ler `analysis-input.json`. |

### 1.2 Motor e inteligência (`src/intelligence`, `src/domain`)

| Item | Como funciona |
|---|---|
| Catálogo de códigos | `App.reasonCodes` reúne cerca de 175 códigos, cada um com categoria, severidade, modos e rótulo para cliente e para corretor. Nenhum código aparece como texto na interface. |
| Lotes excluídos | O resultado da recomendação lista cada lote excluído com a etapa, a regra e o valor real comparado ao esperado. A explicação de um lote excluído usa esse detalhe. |
| Avisos de conflito | Derivados dos dados: `BUDGET_BELOW_CHEAPEST_MATCH`, `BUDGET_BELOW_CHEAPEST_LOT` e `CONSTRAINT_UNSATISFIABLE`. Nenhuma exigência é afrouxada (`autoRelaxed: false`). |
| Candidatos em revisão | Cada um tem um motivo principal e uma categoria: disponibilidade, dado comercial, dado de exigência ou dado do perfil. |
| Lotes inválidos | Lote sem identidade, sem disponibilidade ou de outro empreendimento passa a gerar diagnóstico, em vez de só entrar na contagem. |
| Qualidade do dado | Os fatores de qualidade trazem os valores usados. |
| Comparação | A comparação de dois lotes marca os fatores não comparáveis. `compareMany` compara de 2 a 4 lotes. |
| ViewModel da explicação | Monta título, fatores, trade-offs e qualidade do dado conforme o modo e o nível. |
| Exigências | A validação detecta limites contraditórios em qualquer métrica. |
| Fit | `validateConfig` confere a metodologia antes do uso. Um matcher que falha marca a preferência como `FAILED` e nunca conta como 0. A chave do cache inclui a revisão dos dados e uma impressão digital dos valores lidos. O perfil recebe avisos de preferência impossível, de preferências contraditórias e de trade-off. |
| Metodologia | A validação exige justificativa para critério com contribuição zero (`ZERO_CONTRIBUTION`). A montagem da configuração faz o build falhar quando a versão de um arquivo não confere. |
| Domínio do lote | O aviso `UNKNOWN_PROVENANCE` passou a ser emitido. Nos 498 lotes publicados não há nenhum caso. |

### 1.3 Filtros (`src/filters`)

| Item | Como funciona |
|---|---|
| Resultado do filtro | Traz status (inclusive `PARTIAL`), os lotes que não atendem, facetas com contagem por opção e diagnóstico de zero resultados com sugestões de qual filtro tirar. |
| Filtros não aplicados | Todo filtro que não pôde ser aplicado é informado em `query.dropped` e aparece como não aplicado no painel, em todos os modos. |
| Filtros novos | Busca por código de lote ou quadra, preço por m², testada, profundidade, cobertura e confiança mínimas do Fit e frescor. |
| "Não informado" | Opção disponível em ruído, privacidade, trânsito, formato e frescor. |
| Versões e links | Migração de query e de estado para versões anteriores. `serializeChecked` confere o tamanho do link. |

### 1.4 Interface, celular e acessibilidade

**Modos e Quick View**

- Botão do modo Técnico, oculto abaixo de 420 px.
- Botão "Apresentar", que mostra uma visão limpa para o cliente. Esc ou "Sair da apresentação" volta ao modo anterior.
- A Quick View tem uma ação principal, duas secundárias e as demais em "Mais ações".
- Os fatos estimados mostram selo de origem, e o corretor vê a nota "Estimados nesta ficha".
- O limite de cobertura baixa vem da configuração do Fit.
- Sem conexão, a Quick View mostra uma nota própria sobre preço e disponibilidade.
- A Quick View avisa quando o lote está fora da recomendação, e "Por quê?" explica a regra e os valores.

**Celular**

- O botão voltar fecha as camadas em ordem (modal, popover, gaveta, sobreposição, detalhes, folha expandida, lote) sem sair do app.
- Um link direto para um lote abre a folha na altura intermediária, e a folha expandida nunca é restaurada.
- As alturas da folha incluem a área segura do iPhone.
- A velocidade do arraste é suavizada nos últimos ~100 ms.
- Arrastar o conteúdo move a folha, com passagem para a rolagem: puxar para baixo quando a rolagem está no topo e empurrar para cima antes de expandir.
- A câmera usa a medida real dos controles flutuantes, e a pinça conta como movimento manual.
- "Voltar ao lote" aparece também quando o lote está escondido atrás da folha.
- Em telas de toque, os botões e os itens da legenda têm 44 px de altura mínima (as exceções estão na seção 4).

**Mapa e legenda**

- O resultado de busca pisca no mapa (lote ou quadra).
- Passar o mouse ou o foco sobre um item da legenda destaca os lotes dele sem filtrar.
- O foco volta ao item depois que a legenda é redesenhada, e as mudanças são anunciadas por `aria-live`.
- A escala mostra a posição do lote selecionado.
- "Aplicar" um status pela legenda soma esse status aos já escolhidos, em vez de substituir.
- Os popovers são diálogos com rótulo, devolvem o foco ao elemento que os abriu e, abaixo de 600 px, abrem como folha inferior.
- O controle de intensidade da cor aparece só nas camadas que aceitam opacidade.
- Uma camada indisponível volta para a camada anterior antes da camada padrão do empreendimento.

**Foco e leitor de tela**

- Ao abrir um lote pela busca ou por uma lista, o foco vai para o título do lote e volta para quem abriu quando ele é fechado.
- A troca de lote é anunciada ao leitor de tela.

**Clientes e filtros**

- Cada cliente guarda as próprias preferências e exigências, sem dado pessoal além do nome ou apelido.
- O painel de filtros mostra a caixa de zero resultados com sugestões no formato "tirar filtro X → N lotes".
- Os filtros que não foram aplicados aparecem como tal, e há a opção "incluir lotes não informados".
- O botão "Salvar como exigência do cliente" é explícito: os filtros nunca mudam o perfil sozinhos.
- A gaveta do celular ganhou o botão "Ver N lotes no mapa".
- Eventos de analytics: ações rápidas, zero resultados, sugestão aplicada, filtros salvos como exigência, opacidade da camada e apresentação.

**Recomendação e comparação**

- A lista de recomendação mostra o motivo de revisão de cada lote e os avisos de conflito.
- A explicação para o corretor tem tabela por preferência.
- A comparação mostra "Para o perfil do cliente", com o melhor lote por preferência ou "não comparável" quando falta dado, e avisa quando um lote comparado está fora dos filtros atuais.

### 1.5 Offline

O Service Worker guarda as fotos da galeria e as listas de rotas e da galeria (`routes.json`, `img_list.json`) para uso sem conexão. Preço, disponibilidade e análise nunca passam por esse cache.

## 2. Como foi verificado

| Verificação | Resultado |
|---|---|
| Testes do backend | 128 passando (94 anteriores e 34 novos) |
| Testes do painel | 326 passando |
| Paridade da pré-visualização de análise | Motor do backend igual ao do frontend em 498 lotes × 45 campos |
| Paridade da recomendação (módulo antigo contra novo) | Idêntica nos 25 cenários |
| Paridade do Fit | Idêntica nos 10 perfis |
| Paridade dos filtros | Idêntica nos 26 estados de filtro, nos 3 modos |
| Cores do mapa contra a versão publicada | 0 diferenças em 17 camadas e 5 chaves de score, nos 498 lotes |
| Navegador (Chromium) | Larguras de 320, 390, 768, 1024, 1400 e 1700 px, nos temas claro e escuro, e recarga offline com o Service Worker. Nenhuma largura teve rolagem horizontal. |

## 3. O que depende do proprietário (Edmilson)

Estes itens não podem ser resolvidos só com código: precisam de dados ou de decisões.

| Pendência | Por que importa |
|---|---|
| Espelho de vendas (fonte da disponibilidade) | Os 498 lotes estão como `UNKNOWN`, então toda recomendação cai em revisão. |
| Dados de topografia e regulamento construtivo | Sem eles, os campos e filtros correspondentes ficam vazios. |
| Prazos de atualidade e validade de preço e status | Sem esses prazos, um preço ou status salvo nunca envelhece. |
| Hospedagem da API, domínio, Postgres gerenciado e CDN | O backend está pronto, mas não está publicado. |
| Quando o painel passa a ler da API (`useBackendData`) | Hoje o painel lê os arquivos publicados. |
| Pedido de armazenamento persistente e download de pacote offline | O cache offline ainda é preenchido só pelo uso. |
| Confirmação do ajuste de privacidade de B67 e B68 | O ajuste aguarda confirmação. |
| Exposição de `proposalId` e `notes` | `/availability` e `/lots/{id}/availability/history` ainda expõem esses campos. |
| Empreendimentos em rascunho (`DRAFT`) | Falta decidir se a API deve listá-los. |
| Ordenação por "distância à portaria" | Falta decidir se usa a distância pela rota. |
| Confiança mínima do Fit por tier | Hoje `minFitConfidence` manda para revisão em todos os tiers. |
| Regras no código ou na configuração | Destaques, severidade de alertas e o limite de frente estreita continuam no código. |

## 4. Pendências técnicas menores

Ajustes feitos depois, ainda em 08/10/2026:

- Os 20 motivos de ajuste do score técnico (por exemplo, "Ruído da avenida" e "Vizinho nos fundos") entraram no catálogo de códigos e aparecem por critério na explicação técnica do score.
- A explicação de posição avisa quando uma preferência não pôde ser comparada por falta de dado.
- O link do mapa respeita o limite de tamanho: se os filtros deixariam o link longo demais, eles ficam fora do link e continuam aplicados na tela.
- Os fatores de qualidade do dado usam o catálogo de códigos quando não há texto próprio.

Estes itens não dependem do proprietário e ficaram para uma próxima rodada.

- O formato do resultado de `whyNot` não mudou.
- `quickFilterOrder` ordena os filtros rápidos por `mobilePriority`, mas o painel ainda não usa essa ordem.
- A aplicação de faixa pela legenda soma situações; uma faixa de preço ou área substitui a faixa anterior do mesmo filtro, porque o filtro guarda uma faixa só (comportamento mantido de propósito).
