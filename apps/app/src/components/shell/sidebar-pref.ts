const KEY = 'boogbe:sidebar-collapsed';

/** Private mode or blocked site data can make storage throw; the sidebar then just starts expanded. */
export function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCollapsed(v: boolean): void {
  try {
    if (v) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* the preference is a convenience; ignore */
  }
}
