# Modelo de ações contextuais (nível 3)

| id | Rótulo | Prioridade | Handler (data-act) | Modos | Ícone |
|---|---|---|---|---|---|
| primary | Ação principal | PRIMARY | primary | broker, client, technical, presentation | calc |
| details | Detalhes | PRIMARY | panel | broker, client, technical | list |
| compare | Comparar | PRIMARY | cmp | broker, client, technical | cmp |
| simulate | Simular | PRIMARY | panel | broker, client, technical | calc |
| favorite | Favoritar | SECONDARY | fav | broker, client, technical | heart |
| share | Compartilhar | SECONDARY | share | broker, client, technical, presentation | share |
| solar | Sol no lote | SECONDARY | panel | broker, client, technical | sun |
| routeGate | Rota à portaria | OVERFLOW | route | broker, client, technical | route |
| routeLeisure | Rota ao clube | OVERFLOW | route | broker, client, technical | route |
| explain | Por que esta posição? | OVERFLOW | explain | broker, technical | info |
| copyId | Copiar ID técnico | OVERFLOW | copyId | technical | copy |
| provenance | Origem dos dados | OVERFLOW | prov-open | technical | info |

- `ContextualActionDefinition { id, labelKey, iconId, priority: PRIMARY|SECONDARY|OVERFLOW, requiredPermission (via feature do data-act), availableModes, handlerId }`.
- O renderizador continua sendo o QuickView (tópico 20); o registro é o metadado canônico e um teste garante que **toda ação do QuickView tem definição** (sem menus inconsistentes).
- Corretor: PRIMARY = Ação principal, Detalhes, Comparar, Simular; SECONDARY = Favoritar, Compartilhar, Sol no lote; OVERFLOW = Rota à portaria, Rota ao clube, Por que esta posição?.
- Técnico acrescenta no OVERFLOW: Copiar ID técnico, Origem dos dados (o menu primário não muda, §214).
- Solar, Simular (financeiro), Scores, Proveniência e Compartilhar **não** são destinos primários: são ações do lote (Mapa → lote → QuickView → ação).
