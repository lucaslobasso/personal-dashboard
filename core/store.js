// localStorage wrapper. Every access is guarded: storage can be missing or full
// (private windows, blocked site data), and the dashboard must still work without it.
// mock.html sets __PD_PREFIX so its fake token never overwrites a real one on the same origin.
const PREFIX = globalThis.__PD_PREFIX || "pd:";

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  del(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
  },
  clear(prefix = "") {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(PREFIX + prefix)) localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
  },
};
