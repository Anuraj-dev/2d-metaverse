import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// No WebAudio/track in jsdom, so the analyser is null and the meter renders unlit
// segments without crashing (the graceful-degradation path used in e2e too).
vi.mock("../media/livekit", () => ({ localAudioTrack: () => null }));
vi.mock("../media/localMedia", () => ({ getStream: () => null }));
vi.mock("../net/auth", () => ({ USE_MOCK: false }));

import MicMeter from "./MicMeter";

afterEach(cleanup);

describe("MicMeter", () => {
  it("renders its segments and lights none without an analyser", () => {
    const { container } = render(<MicMeter />);
    const segs = container.querySelectorAll(".mic-seg");
    expect(segs.length).toBe(4);
    expect(container.querySelectorAll(".mic-seg.on").length).toBe(0);
  });
});
