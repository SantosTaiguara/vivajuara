# Viva Juara · Plataforma de lotes

Painel de inteligência comercial dos 498 lotes do Viva Juara (Serra/ES): mapa de lotes, busca, comparação, clientes, apresentação, mapa do entorno e área administrativa, mais o servidor (Node + PostgreSQL) que ainda não está no ar.

## Pastas

| Pasta | Conteúdo |
|---|---|
| `dash/` | Painel pronto para publicar (arquivos estáticos): `index.html`, `admin.html`, `chunks/`, dados (`lots.json`, `routes.json`, `analysis-input.json`), imagens e service worker. |
| `codigo/src/` | Código-fonte do painel (módulos que se registram no objeto global `App`). |
| `codigo/config/` | Configurações por empreendimento (permissões, recursos, governança, privacidade, qualidade de dados etc.). |
| `apresentacao/` | Apresentação da House 7 em HTML (slides do lançamento), publicada em `/apresentacao/`. |
| `codigo/scripts/` | Build do painel (`build.js`), área administrativa (`buildAdmin.js`), cabeçalhos de segurança e geradores de documentação. |
| `codigo/tests/` | Testes do painel (`node:test`). |
| `codigo/backend/` | Servidor (monólito modular Node 20 + PostgreSQL 16), migrações 001–016, contrato OpenAPI. |
| `codigo/docs/` | Relatórios e documentação técnica em português (um `RELATORIO_TOPICO_<N>.md` por tópico da especificação). |

## Como gerar o painel

```bash
cd codigo
node scripts/build.js        # gera dash/index.html, dash/admin.html, dash/chunks/, sw.js e manifestos
node scripts/hostgator.js     # monta ../hostgator/ com .htaccess para a HostGator (ver docs/COMO_PUBLICAR_HOSTGATOR.md)
node scripts/vercel.js        # gera ../vercel.json (Vercel publica dash/; ver docs/COMO_PUBLICAR_VERCEL.md)
```

O painel é estático: basta publicar a pasta `dash/` em qualquer hospedagem (inclusive planos compartilhados).

## Testes

```bash
cd codigo/tests && npm install && npm test          # testes do painel
cd codigo/backend && npm install
node --test tests/round5Wiring.test.js tests/authGoogle.test.js   # testes do servidor sem banco
npm test                                             # suíte completa (precisa de PostgreSQL 16)
npm run openapi:check
```

## Servidor

O servidor precisa de Node.js 20+ e PostgreSQL 16 (uma VPS, não hospedagem compartilhada só com PHP/MySQL). Copie `codigo/backend/.env.example` para `.env` e preencha na própria hospedagem. **Nunca coloque chaves, senhas ou o segredo do Google no repositório.** Guia do login Google: `codigo/backend/docs/GUIA_GOOGLE_CLOUD_OAUTH.md`. Ligação das áreas novas (propostas, onboarding, LGPD, console, qualidade de dados, entorno): `codigo/backend/docs/RELATORIO_LIGACAO_ROTAS_57_63.md`; cada área tem um interruptor `FEATURE_*`, desligado por padrão.

## Regras do projeto

- Nenhum dado é inventado: valores sem fonte aparecem como "não disponível" ou "necessita confirmação".
- Preço de tabela de 2026-10-06 (R$ 1.196/m²); nenhuma promessa de valorização.
- A disponibilidade dos 498 lotes está "não confirmada" até a loteadora enviar o espelho de vendas.
- Regras comerciais e prazos jurídicos (LGPD) ficam vazios até decisão da House 7 e do jurídico; o sistema recusa a ação enquanto isso.
