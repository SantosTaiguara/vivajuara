# Política de navegação offline

| Item | Offline | Mensagem |
|---|---|---|
| MAP | FULL (sem pacote / servidor: ONLINE_REQUIRED) | Requer conexão. Volte a ficar on-line para abrir. |
| FIND | FULL | — |
| COMPARE | FULL | — |
| CUSTOMERS | FULL (sem pacote / servidor: ONLINE_REQUIRED) | Requer conexão. Volte a ficar on-line para abrir. |
| DEVELOPMENT | LAST_KNOWN | Sem conexão: mostrando as informações da última sincronização. |

- `OfflineNavCapability { navItemId, state: FULL|READ_ONLY|LAST_KNOWN|ONLINE_REQUIRED, messageKey }`.
- Clientes: hoje os clientes são locais ao aparelho (`customer.profile` com `deviceLocal:true`) → FULL. Quando passarem ao servidor, o mesmo item vira ONLINE_REQUIRED (desabilitado com explicação), sem mudar código (teste NavOfflineCustomersOnlineRequired).
- Mapa sem pacote offline → desabilitado com explicação (no primeiro acesso offline o shell já mostra "Sem conexão").
- Um único indicador global de conectividade (o indicador de sincronização/netbar); nada de badge em cada item.
- Seções administrativas `online` ficam desabilitadas offline. Política de PWA do tópico 49 prevalece para cache/pacotes.
