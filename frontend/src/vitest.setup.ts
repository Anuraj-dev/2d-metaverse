/**
 * Node 25+ (this host is 26) exposes experimental `localStorage` /
 * `sessionStorage` globals that stay `undefined` unless the process is started
 * with `--localstorage-file`. jsdom still installs Storage on `window`, but the
 * bare `localStorage` identifier tests use stays the Node binding, so
 * `localStorage.clear()` throws and ~38 frontend tests fail.
 *
 * Rebind both names to a working Storage implementation before any suite runs.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(String(key), String(value));
    },
  };
}

function isStorage(value: unknown): value is Storage {
  if (typeof value !== "object" || value === null) return false;
  if (!("getItem" in value) || typeof value.getItem !== "function") return false;
  if (!("setItem" in value) || typeof value.setItem !== "function") return false;
  if (!("clear" in value) || typeof value.clear !== "function") return false;
  return true;
}

function readNamed(name: "localStorage" | "sessionStorage"): unknown {
  if (name === "localStorage") return globalThis.localStorage;
  return globalThis.sessionStorage;
}

function readWindowNamed(name: "localStorage" | "sessionStorage"): unknown {
  if (typeof window === "undefined") return undefined;
  return name === "localStorage" ? window.localStorage : window.sessionStorage;
}

function workingStorage(name: "localStorage" | "sessionStorage"): Storage {
  const current = readNamed(name);
  if (isStorage(current)) return current;
  const fromWindow = readWindowNamed(name);
  if (isStorage(fromWindow)) return fromWindow;
  return memoryStorage();
}

function install(name: "localStorage" | "sessionStorage"): void {
  const storage = workingStorage(name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: storage,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: storage,
    });
  }
}

install("localStorage");
install("sessionStorage");

export {};
