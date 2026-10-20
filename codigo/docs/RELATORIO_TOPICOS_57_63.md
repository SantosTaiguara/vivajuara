# Relatório consolidado — Tópicos 57, 58, 59, 60, 61 e 63 (2026-10-17)

O tópico 62 (Continuidade de Negócio, Backup e DR) não foi recebido. O tópico 63 o cita como dependência; a lacuna está registrada em RELATORIO_TOPICO_63.md (backup das tabelas da migração 016 e classificação REFERENCE_ONLY).

Este material não é aconselhamento jurídico. Todo valor de política comercial, jurídica ou operacional que não foi informado ficou **vazio (null) com status "necessita confirmação"**, e o código **recusa** a ação enquanto o valor não existir. Nenhum dado foi inventado; IDs, geometria, scores, preços (R$ 1.196/m², tabela 2026-10-06) e regras financeiras não mudaram.

## O que mudou para quem abre o painel

Para o visitante, o painel continua igual, com uma adição: em Empreendimento → "Uso offline" há a seção recolhida **"Dados neste aparelho"** (tópico 59). Ela lista o que o painel guarda neste navegador e permite baixar esses dados (arquivo JSON com checksum) ou apagá-los (só dados pessoais, ou tudo), sempre com confirmação. Nada vai para servidor. Não aparece no modo Cliente.

O **console administrativo** (tópico 60) é uma página separada, `admin.html`, que não tem link no painel. Sem sessão confirmada pelo servidor ela mostra apenas "Acesso restrito", sem botões nem dados. Lá ficam, quando houver servidor e papéis definidos, propostas e reservas (57), onboarding (58), governança de privacidade (59), qualidade de dados (61) e o Entorno (63), que hoje mostra "Coordenada oficial do empreendimento ainda não validada."

O Entorno não entrou no painel público porque passaria do limite de tamanho da página (3.400.000 bytes de JS; a página está com 3,40 MB e sobra cerca de 1 KB). Qualquer acréscimo futuro ao painel público vai exigir dividir o código em partes carregadas sob demanda.

## Resumo por tópico

| Tópico | Onde está | Testes (painel / servidor) | Estado |
|---|---|---|---|
| 57 Proposta, Reserva, Negociação e Fechamento | src/deals, backend/src/modules/deals, migração 011 | 6 / 23 | Pronto, bloqueado até definir políticas comerciais e papéis |
| 58 Onboarding e Pipeline de Ingestão | src/onboarding, backend/src/modules/onboarding, migração 012 | 26 / 6 | Pronto; os 498 IDs atuais saem idênticos (teste golden) |
| 59 LGPD, Privacidade e Ciclo de Vida | src/privacy, config/privacy, backend/src/modules/privacy, migração 013 | 33 / 8 | Central de dados do aparelho; valores jurídicos a validar |
| 60 Backoffice / Console Administrativo | src/backoffice, backend/src/modules/backoffice, migração 014 | 15 / 11 | Console separado (admin.html), sem acesso até definir papéis |
| 61 Qualidade de Dados e Governança | src/dataquality, config/dataquality, backend/src/modules/dataquality, migração 015 | 31 / 7 | Checagem real feita; donos e metas a definir |
| 63 Google Maps, Entorno e raio de 8 km | src/surroundings, backend/src/modules/surroundings, migração 016 | 14 / 23 | Desligado; coordenada oficial não validada |

Relatórios detalhados: RELATORIO_TOPICO_57.md, _58, _59, _60, _61 e _63.

## Checagem real de qualidade (tópico 61, somente leitura)

Resultado sobre os 498 lotes: **aprovado com alertas**.
- Disponibilidade desconhecida em 498 de 498 lotes.
- Os campos de ID do lote e do empreendimento não têm fonte registrada.
- 30 dos 54 campos que aceitam vazio têm algum valor vazio.
- Identidade, geometria, preços e análise passaram.
- Por causa da disponibilidade desconhecida, o portão de qualidade bloqueia reserva e envio de proposta; importação de lotes passa.

## Servidor

Os seis módulos novos têm rotas, contratos OpenAPI (fragmentos separados) e migrações 011 a 016 com scripts de reversão, mas **não estão ligados ao servidor**. Registrar as permissões no IAM do servidor daria todas automaticamente ao papel OWNER_ADMIN, e isso precisa de decisão. Os testes que exigem Postgres continuam sem rodar (sem senha do banco; a autenticação do Postgres não foi alterada).

Permissões novas (todas sem papel e sem acesso anônimo): 24 do 57, 8 do 58, 6 do 59, 26 do 60, 10 do 61 e 3 do 63, registradas em PERMISSION_REGISTRY.md.

## Verificação

- Testes do painel: 1209 de 1209 passando. Testes de servidor sem banco: 57 (23), 58 (6), 59 (8), 60 (11), 61 (7), 63 (23), todos passando.
- Paridade de cores do mapa (t18): TOTAL DIFF 0. Linhas de base golden: sem desvio. Contrato OpenAPI: atualizado.
- Navegador (Chromium) em 320, 768, 1280 e 1700 px, claro e escuro: sem erros no console, 498 lotes no mapa, sem rolagem lateral da página; central de privacidade abre, exporta e confirma; admin.html em 390 e 1280 px só mostra "Acesso restrito".
- Ressalva: em 320 px a tabela "Fontes" (já existente) do Empreendimento rola de lado dentro do painel.
- Publicado como versão 17 do mesmo link. A exportação usa o download do visualizador do claude.ai, que pede confirmação.

## Decisões pendentes

**Coordenada e Google Maps (63)**
- Coordenada oficial do Viva Juara e a fonte que a valida.
- Projeto Google Cloud, chaves (só em variável de ambiente do servidor, nunca no chat), restrições, orçamento e alertas de cobrança.
- Limites de uso, revisão dos termos e atribuição do Google, renovação dos Place IDs salvos, manter ou não campos de avaliação (custam mais).

**Comercial (57)**
- Matriz de alçadas, ordem do fluxo proposta → reserva → fechamento, concorrência de propostas.
- Limites de aprovação de desconto e se aprovador deve ser diferente do solicitante.
- Duração máxima da reserva e regras de prorrogação; o que acontece com o lote após cancelamento.
- Checklist de fechamento, definição de venda ganha (WON), modelos de contrato aprovados pelo jurídico, provedor de assinatura, fuso horário comercial.

**Jurídico e privacidade (59)**
- Bases legais das 14 finalidades, prazos de retenção das 16 políticas, prazos de atendimento ao titular e calendário de feriados.
- Prazo de comunicação de incidente (a especificação diz 3 dias úteis, não validado), encarregado (DPO), textos de aviso, matriz controlador/operador, revisão de 6 fornecedores e 4 transferências internacionais.
- Nomes de clientes guardados no aparelho e o nome que vai no link do WhatsApp.

**Operação e console (58, 60)**
- Quais papéis recebem as permissões novas, inclusive se o OWNER_ADMIN recebe automaticamente.
- Método de segunda verificação (step-up/MFA), tempo de inatividade, duração da sessão de suporte, limites de ações em lote, prazos das filas.
- Limite de variação de preço que exige revisão, cobertura mínima de preços, mapeamento dos status externos de disponibilidade.
- Antivírus real para arquivos enviados, extrator de KMZ/XLSX/DOCX, armazenamento de arquivos e limites de upload.

**Qualidade de dados (61)**
- Donos e responsáveis dos 12 domínios, fonte oficial de disponibilidade e de documentos.
- Limites de atualização por uso, metas de nível de serviço, política de exceções, tolerâncias de volume e distribuição, validade de certificação, política SEV1 a SEV4.
