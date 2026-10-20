# Matriz de suporte por navegador

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

| Navegador | Service Worker | Prompt de instalação | Background Sync | Periodic Sync | Estimativa de armazenamento | Observação |
|---|---|---|---|---|---|---|
| Chrome desktop | SIM | SIM (beforeinstallprompt) | SIM | SÓ APP INSTALADO | SIM | referência dos testes E2E (Chromium/Playwright). |
| Chrome Android | SIM | SIM | SIM | SÓ APP INSTALADO | SIM | evicção sob pressão de armazenamento; pedir persistência ao preparar pacote. |
| Edge | SIM | SIM | SIM | SÓ APP INSTALADO | SIM | Chromium. |
| Safari macOS | SIM | NÃO (menu Arquivo › Adicionar ao Dock) | NÃO | NÃO | SIM | sincronização ao voltar ao primeiro plano. |
| Safari iOS | SIM | NÃO (Compartilhar › Adicionar à Tela de Início) | NÃO | NÃO | PARCIAL | dados podem ser apagados após dias sem uso: pacote offline pode precisar ser refeito. |
| Firefox | SIM | NÃO (desktop) | NÃO | NÃO | SIM | funciona como web app normal. |

- Detecção por recurso (`detectCapabilities`), nunca por User-Agent (§249). iOS é reconhecido por `navigator.standalone` sem `beforeinstallprompt` → instruções manuais.
- Sem Service Worker: o app funciona online normalmente (§250, §372). Sem Background Sync: sincroniza ao voltar ao primeiro plano / reconectar / "Tentar novamente". Sem prompt: o app continua web normal. Sem Cache Storage: pacote em memória (aviso) e cópia de dados no IndexedDB.
- Push, geolocalização, câmera: **não** implementados nem solicitados (§228–§230).
- Testado de verdade: Chromium (Playwright, `tests/pwa.e2e.js`). Safari/Firefox: não testados neste ambiente.
