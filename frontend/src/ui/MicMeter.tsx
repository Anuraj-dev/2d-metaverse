import { useEffect, useRef, useState } from "react";
import { startMicAnalyser } from "../media/micLevel";
import { meterDecay, meterSegments } from "../game/micMeter";

const SEGMENTS = 4;

/**
 * Live mic input-level meter (PRD 20). Rendered only while the mic is on (the bar
 * mounts/unmounts it with the mic state). It polls a WebAudio analyser once per
 * frame and eases the reading through the pure `game/micMeter` mapping; when no
 * analyser is available (jsdom, or e2e fake-media) it renders nothing.
 */
export default function MicMeter() {
  const [lit, setLit] = useState(0);
  const levelRef = useRef(0);

  useEffect(() => {
    const analyser = startMicAnalyser();
    if (!analyser) return;
    let raf = 0;
    const tick = () => {
      levelRef.current = meterDecay(levelRef.current, analyser.read());
      setLit(meterSegments(levelRef.current, SEGMENTS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      analyser.stop();
    };
  }, []);

  return (
    <span className="mic-meter" aria-hidden="true">
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span key={i} className={`mic-seg ${i < lit ? "on" : ""}`} />
      ))}
    </span>
  );
}
