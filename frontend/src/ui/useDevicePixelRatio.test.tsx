import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useDevicePixelRatio } from "./useDevicePixelRatio";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("useDevicePixelRatio", () => {
  it("tracks display density changes and releases both resize and media listeners", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const queries: EventTarget[] = [];
    const matchMedia = vi.fn(() => {
      const query = new EventTarget();
      queries.push(query);
      // The hook only consumes EventTarget's change listener methods.
      return query as MediaQueryList;
    });
    vi.stubGlobal("matchMedia", matchMedia);
    const removeResize = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useDevicePixelRatio());
    expect(result.current).toBe(1);
    const initial = queries[0];
    if (!initial) throw new Error("Resolution listener missing");
    const removeInitial = vi.spyOn(initial, "removeEventListener");
    act(() => {
      vi.stubGlobal("devicePixelRatio", 2);
      initial.dispatchEvent(new Event("change"));
    });
    expect(result.current).toBe(2);
    expect(matchMedia).toHaveBeenLastCalledWith("(resolution: 2dppx)");
    expect(removeInitial).toHaveBeenCalledWith("change", expect.any(Function));
    const current = queries.at(-1);
    if (!current) throw new Error("Updated resolution listener missing");
    const removeCurrent = vi.spyOn(current, "removeEventListener");
    unmount();
    expect(removeCurrent).toHaveBeenCalledWith("change", expect.any(Function));
    expect(removeResize).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
