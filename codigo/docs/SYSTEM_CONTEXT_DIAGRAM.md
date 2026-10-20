# Diagrama de contexto do sistema (C4 nível 1)

Quem usa a plataforma e com quais sistemas ela conversa. Setas indicam quem inicia. Linhas tracejadas = previsto, ainda não ligado.

```mermaid
flowchart LR
  corretor["Corretor (House 7)<br/>modo corretor/técnico"]
  cliente["Cliente final<br/>modo cliente / link compartilhado"]
  admin["Administrador<br/>publica tabela, status, análise"]
  subgraph plataforma["Plataforma de Inteligência Comercial (Viva Juara)"]
    web["web-client (PWA de página única)"]
    api["api-backend (monolito modular, REST v1)"]
  end
  loteadora["Loteadora / espelho de vendas<br/>(fonte da disponibilidade — não existe hoje)"]
  fontes["Fontes oficiais<br/>planta PDF, KMZ, tabela de preços"]
  whatsapp["WhatsApp (wa.me)"]
  crm["CRM (Kenlo ou outro)"]
  idp["Provedor de identidade (OIDC)"]
  corretor --> web
  cliente --> web
  admin --> api
  web --> api
  web -->|link wa.me com texto montado no aparelho| whatsapp
  fontes -->|importação versionada| api
  loteadora -.->|feed de disponibilidade| api
  api -.->|sincronização com ownership definido| crm
  web -.->|login| idp
  api -.->|valida token| idp
```

| Fronteira | Hoje | Alvo | Pendência |
|---|---|---|---|
| Corretor ↔ web-client | painel estático, sem login; permissões locais deny by default | login real; `/me` como fonte do AccessControlViewModel | D-IDP |
| Cliente ↔ web-client | modo cliente e apresentação no aparelho do corretor; share local | ShareGrant com token no servidor | tópico 42 (contratos) |
| web ↔ api | o painel lê `dash/*.json`; `data/apiSource.js` pronto para `/api/v1` | leitura pela API com shadow read | fase 3.2 |
| Loteadora → api | inexistente: 498 lotes `UNKNOWN` | feed com revisão e frescor | D-SALES-MIRROR, D-AVAIL-FRESHNESS |
| api → CRM | inexistente | adaptador com ownership por campo | D-CRM-OWNERSHIP |
| web → WhatsApp | texto montado no aparelho (`shareVM`) | ShareChannel template | D-WHATSAPP-TEXT |
| Terceiros de analytics (GA/Meta) | nenhum envio; tudo local | só com base legal | D-ANALYTICS-LEGAL |
