import {
  SNAKE_LEVELS,
  SNAKE_SPEEDS,
  snakeLevelById,
  type SnakeLevelId,
  type SnakeSpeedId,
} from "../../game/arcade/snake";

export interface SnakeOptionsProps {
  speed: SnakeSpeedId;
  level: SnakeLevelId;
  /** Picking either option starts a fresh run (the board shape changes). */
  onPickSpeed: (id: SnakeSpeedId) => void;
  onPickLevel: (id: SnakeLevelId) => void;
}

/**
 * Snake's cabinet options: speed tier + level. Both lists are DATA from the pure
 * `game/arcade/snake` module — this component never knows what a level contains,
 * only how to list it. The chosen values are persisted by the overlay through
 * the shared settings store.
 */
export default function SnakeOptions({
  speed,
  level,
  onPickSpeed,
  onPickLevel,
}: SnakeOptionsProps) {
  return (
    <div className="arcade-options">
      <div className="arcade-optgroup" role="group" aria-label="Snake speed">
        <span className="arcade-optlabel">Speed</span>
        {SNAKE_SPEEDS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`arcade-opt${s.id === speed ? " is-on" : ""}`}
            aria-pressed={s.id === speed}
            onClick={() => onPickSpeed(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="arcade-optgroup" role="group" aria-label="Snake level">
        <span className="arcade-optlabel">Level</span>
        {SNAKE_LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`arcade-opt${l.id === level ? " is-on" : ""}`}
            aria-pressed={l.id === level}
            title={l.hint}
            onClick={() => onPickLevel(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      <p className="arcade-levelhint">{snakeLevelById(level).hint}</p>
    </div>
  );
}
