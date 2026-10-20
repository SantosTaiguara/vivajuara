/* layout/shortcuts.js — DesktopShortcutRegistry (topic 22 §101–107) and the tablet subset (topic 23 §164).
   One registry: id, key, label, where it applies. match() turns a keydown into an action id and never fires while
   the user types in a field (except Escape), nor when a browser/OS modifier is held (no Ctrl/Cmd/Alt combinations
   except the explicit Cmd/Ctrl+K). Single letters were checked against browser and screen-reader defaults:
   none of them uses a bare letter on a page that is not in a text field. */
App.shortcuts = (() => {
  const REGISTRY = Object.freeze([
    { id: 'focusSearch', key: '/', label: 'Buscar lote', families: ['DESKTOP', 'TABLET'] },
    { id: 'openFilters', key: 'f', label: 'Abrir ou fechar Encontrar (filtros)', families: ['DESKTOP', 'TABLET'] },
    { id: 'openLayers', key: 'l', label: 'Trocar a camada do mapa', families: ['DESKTOP', 'TABLET'] },
    { id: 'compareCurrent', key: 'c', label: 'Adicionar ou tirar o lote atual da comparação', families: ['DESKTOP'] },
    { id: 'openDetails', key: 'd', label: 'Abrir a ficha completa do lote', families: ['DESKTOP'] },
    { id: 'toggleLeft', key: '[', label: 'Recolher ou abrir o painel esquerdo', families: ['DESKTOP'] },
    { id: 'toggleRight', key: ']', label: 'Recolher ou abrir o painel do lote', families: ['DESKTOP', 'TABLET'] },
    { id: 'mapFocus', key: 'm', label: 'Mapa em foco (recolhe os dois painéis)', families: ['DESKTOP'] },
    { id: 'help', key: '?', label: 'Mostrar os atalhos', families: ['DESKTOP', 'TABLET'] },
    { id: 'commandSearch', key: 'k', mod: true, label: 'Buscar lote (Cmd/Ctrl+K)', families: ['DESKTOP', 'TABLET'] },
    { id: 'closeTransient', key: 'Escape', label: 'Fechar popover, menu ou painel temporário (não limpa a seleção)', families: ['DESKTOP', 'TABLET', 'MOBILE'], always: true }
  ]);
  const isTyping = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || (t.closest && t.closest('[role=listbox],[contenteditable=true]')));
  /** keydown → action id or null. family limits the set (tablets get the essential subset only). */
  function match(e, { family = 'DESKTOP' } = {}) {
    if (!e || e.defaultPrevented || e.isComposing) return null;
    const key = e.key, mod = !!(e.ctrlKey || e.metaKey);
    for (const s of REGISTRY) {
      if (!s.families.includes(family)) continue;
      if (s.mod) { if (mod && !e.altKey && String(key).toLowerCase() === s.key) return s.id; continue; }
      if (mod || e.altKey) continue;
      if (s.key === 'Escape' ? key === 'Escape' : String(key).toLowerCase() === s.key.toLowerCase() || key === s.key) {
        if (!s.always && isTyping(e.target)) return null; // never while typing (§105)
        return s.id;
      }
    }
    return null;
  }
  /** conflicts check (used by tests): two shortcuts on the same key + modifier within one family */
  function conflicts() {
    const seen = new Map(), out = [];
    for (const s of REGISTRY) for (const f of s.families) { const k = f + '|' + (s.mod ? 'mod+' : '') + s.key.toLowerCase(); if (seen.has(k)) out.push([seen.get(k), s.id]); else seen.set(k, s.id); }
    return out;
  }
  const list = family => REGISTRY.filter(s => s.families.includes(family));
  const keyLabel = s => s.mod ? 'Ctrl/Cmd + K' : s.key === 'Escape' ? 'Esc' : s.key.toUpperCase();
  return { REGISTRY, match, conflicts, list, keyLabel, isTyping };
})();
