"""Coworking deck (SE) — open-plan LimeZu art pass.

Open-air wood deck painted by gen_campus (FLOOR_ACC at x=57..118, y=62..88).
It is a multiplayer gathering floor, not an outdoor office. Indoor desks,
storage, lounge furniture and isolated floor mats do not belong here. A paired
entrance marker is the whole art pass; the rest stays bare and walkable.

CRITICAL: full-height arcade approach artery at x=79..80. A 32px solid body
spans its centre tile ±1, so no solid prop centre sits on x=77..82. Keep that
corridor completely clear for the spawn→Game Arcade walk.
"""

# Inclusive deck bounds.
CW_X0, CW_Y0, CW_X1, CW_Y1 = 57, 62, 118, 88


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # The uninterrupted wood field is the authored gathering surface.
        pass
    elif phase == "furniture":
        # Paired entrance markers flank the arcade approach without touching
        # the protected x=79–80 corridor or claiming the open deck centre.
        ctx.furn("f_lz_plant_small", 75, 64, True)
        ctx.furn("f_lz_plant_small", 84, 64, True)
    else:
        raise ValueError(f"coworking: unknown phase {phase!r}")
