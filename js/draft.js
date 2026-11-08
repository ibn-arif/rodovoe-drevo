// Черновик: несохранённые правки одного древа. Живёт в localStorage, чтобы пережить
// закрытие вкладки; если хранилище недоступно — только в памяти (persistent = false).

export function safeLocalStorage() {
  try {
    const s = globalThis.localStorage;
    s.setItem('drevo:probe', '1');
    s.removeItem('drevo:probe');
    return s;
  } catch {
    return null;
  }
}

export function createDraft(treeId, storage = safeLocalStorage()) {
  const key = `drevo:draft:${treeId}`;
  const listeners = [];
  let persistent = !!storage;
  let state = { ops: [], baseVersion: 0 };

  if (storage) {
    try {
      const saved = JSON.parse(storage.getItem(key) || 'null');
      if (saved && Array.isArray(saved.ops)) state = { ops: saved.ops, baseVersion: Number(saved.baseVersion) || 0 };
    } catch {
      persistent = false;
    }
  }

  const changed = () => {
    if (persistent) {
      try {
        if (state.ops.length) storage.setItem(key, JSON.stringify(state));
        else storage.removeItem(key);
      } catch {
        persistent = false;
      }
    }
    listeners.forEach(fn => fn(draft));
  };

  const draft = {
    get ops() { return state.ops; },
    get baseVersion() { return state.baseVersion; },
    get persistent() { return persistent; },
    add(op) { state = { ...state, ops: [...state.ops, op] }; changed(); },
    remove(index) { state = { ...state, ops: state.ops.filter((_, i) => i !== index) }; changed(); },
    clear() { state = { ...state, ops: [] }; changed(); },
    setBase(v) { state = { ...state, baseVersion: Number(v) }; changed(); },
    onChange(fn) { listeners.push(fn); },
  };
  return draft;
}
