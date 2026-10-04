import { useSyncExternalStore } from "react";

const readDpr = () => window.devicePixelRatio || 1;

function subscribe(onChange: () => void): () => void {
  let query: MediaQueryList | undefined;
  const changed = () => {
    query?.removeEventListener("change", changed);
    query = window.matchMedia?.(`(resolution: ${readDpr()}dppx)`);
    query?.addEventListener("change", changed);
    onChange();
  };
  changed();
  window.addEventListener("resize", changed);
  return () => {
    window.removeEventListener("resize", changed);
    query?.removeEventListener("change", changed);
  };
}

/** Browser zoom and moving between displays can change backing-store density. */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribe, readDpr, () => 1);
}
