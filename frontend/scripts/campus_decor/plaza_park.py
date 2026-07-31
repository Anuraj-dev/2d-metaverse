"""plaza_park — outdoor density pass for the central plaza + NW park.

Outdoor art direction is density, not re-skin: stone/grass stay as authored.
Existing park shrubs, plaza corner planters, welcome desk, water cooler and
clock remain; this module only ADDS props around them.

Geometry it has to live with (all frozen):
  Plaza  x=12..107, y=26..60   Park  x=1..28, y=1..55
  Spawn  (60,44) — keep a generous open radius
  Info board interactable  (18-19, 38-39)  + welcome desk (16,38) / chair (16,39)
  Portal (27-28, 43-44)   water cooler (65,33)   clock (95,30)
  E-W artery y=43-45 · N-S arteries x=29-30, x=56-63, x=79-80
  Ground labels at (64,45) (69,47) (64,50) (56,52) — leave walkable
  Auditorium shell x=81..118, y=1..44 — OUT of bounds for outdoor props
  HQ shell x=30..79, y=1..24 — already north of the plaza band

Outdoor vocabulary only on open stone: benches, planters/pots, lamp posts,
notice boards, kiosk/market crates, baskets, sparse bins next to seating.
No indoor sofas/armchairs/consoles/cabinets on the plaza paving.

Composition: a handful of named places separated by open paving — not a
uniform sprinkle. Walkability: every open lane ≥2 tiles; solids frame edges
and form off-path seating clusters; nothing blocks arteries or sits on a
seat/door/interactable/board-seat tile.
"""


def decorate(ctx, phase: str) -> None:
    if phase == "floor":
        # Outdoor floors stay grass/stone — density only, no LimeZu rug paint.
        pass
    elif phase == "furniture":
        _furnish(ctx)
    else:
        raise ValueError(f"plaza_park: unknown phase {phase!r}")


def _furnish(ctx) -> None:
    # ── Park: more reason to linger between the trees ─────────────────────
    # Benches face clearings (not on tree trunks / existing shrubs). Solid
    # body ~2 tiles; leave approach gaps to the E-W path at y=43-45 and the
    # N-S park path at x=29-30. No solids on y=43-45.
    ctx.furn("f_lz_bench_gold", 4, 10, True)
    ctx.furn("f_lz_bench_gold", 14, 16, True)
    ctx.furn("f_lz_bench_gold", 7, 25, True)
    ctx.furn("f_lz_bench_gold", 17, 32, True)
    ctx.furn("f_lz_bench_gold", 4, 40, True)
    ctx.furn("f_lz_bench_gold", 13, 41, True)
    ctx.furn("f_lz_bench_gold", 21, 11, True)
    ctx.furn("f_lz_bench_gold", 3, 18, True)

    # Lamp posts along park path edges and deep clearings.
    ctx.furn("f_lz_floor_lamp", 10, 10, True)
    ctx.furn("f_lz_floor_lamp_blue", 18, 14, True)
    ctx.furn("f_lz_floor_lamp", 4, 32, True)
    ctx.furn("f_lz_floor_lamp_blue", 16, 41, True)
    ctx.furn("f_lz_floor_lamp", 26, 20, True)
    ctx.furn("f_lz_floor_lamp_blue", 26, 34, True)
    ctx.furn("f_lz_floor_lamp", 26, 48, True)
    ctx.furn("f_lz_floor_lamp_blue", 7, 6, True)
    ctx.furn("f_lz_floor_lamp", 14, 23, True)

    # Extra greenery (skip existing shrub tiles + tree footprints).
    ctx.furn("f_lz_plant_small", 4, 5, True)
    ctx.furn("f_lz_plant_small", 19, 9, True)
    ctx.furn("f_lz_palm", 7, 16, True)
    ctx.furn("f_lz_plant", 24, 16, True)
    ctx.furn("f_lz_plant_small", 3, 24, True)
    ctx.furn("f_lz_palm", 11, 32, True)
    ctx.furn("f_lz_plant_small", 23, 33, True)
    ctx.furn("f_lz_plant", 4, 48, True)
    ctx.furn("f_lz_plant_small", 16, 50, True)
    # Was (26,42): 32×32 body spilled onto E-W artery y=43 + portal prompt.
    # Then (26,38): collided with gen_campus's own f_plant_big at (25,38).
    ctx.furn("f_lz_palm", 23, 36, True)
    ctx.furn("f_lz_plant_small", 10, 14, True)
    ctx.furn("f_lz_plant", 18, 6, True)
    ctx.furn("f_lz_plant_small", 22, 25, True)
    ctx.furn("f_lz_palm", 5, 28, True)

    # Park clutter — one bin next to a path-side bench (not filler).
    ctx.furn("f_lz_bin", 7, 41, True)
    ctx.furn("f_lz_stool_wood", 5, 15, True)
    ctx.furn("f_lz_basket", 15, 28, False)
    # Non-solid: sits under palm@22,40 body without claiming its tiles.
    ctx.furn("f_lz_basket_lid", 22, 41, False)
    ctx.furn("f_lz_crate", 8, 50, True)
    ctx.furn("f_lz_crate", 20, 20, True)

    # Notice board on the park-side stone edge (west of welcome desk cluster).
    ctx.furn("f_lz_poster_grid", 12, 36, False)

    # ── Place 1: Welcome entry frame (desk 16,38 / board 18-19,38-39) ─────
    # Matched lamps + planters flanking the desk; pinboard as signage.
    # No indoor side-tables or bins on the open stone.
    ctx.furn("f_lz_plant_small", 14, 36, True)
    ctx.furn("f_lz_plant_small", 20, 36, True)
    ctx.furn("f_lz_floor_lamp", 15, 36, True)
    ctx.furn("f_lz_floor_lamp", 21, 36, True)
    ctx.furn("f_lz_plant", 10, 41, True)
    ctx.furn("f_lz_palm", 22, 40, True)
    ctx.furn("f_lz_pinboard", 17, 36, False)
    ctx.furn("f_lz_plant_pot", 15, 40, False)

    # ── Place 2: Market / kiosk nook (west-mid, north of E-W artery) ──────
    # Keep clear of portal (27-28,43-44) and park-path artery x=29-30.
    # 3-wide bodies must sit at x<=27 or x>=32 so they never claim x=29/30.
    ctx.furn("f_lz_kiosk", 27, 32, True)
    ctx.furn("f_lz_board", 32, 32, False)
    ctx.furn("f_lz_crate", 27, 36, True)
    ctx.furn("f_lz_boxes", 32, 36, True)
    ctx.furn("f_lz_basket", 25, 36, False)
    ctx.furn("f_lz_basket_lid", 32, 34, False)
    ctx.furn("f_lz_plant_small", 25, 34, True)
    ctx.furn("f_lz_stool_wood", 25, 32, True)

    # ── Place 3: HQ north-edge promenade (under HQ south wall, y=27-30) ───
    # Planter / lamp / bench rhythm along the facade. Doors ≈49-50 and ≈58-59
    # stay clear. Stay west of auditorium shell (x < 81).
    ctx.furn("f_lz_plant", 32, 28, True)
    ctx.furn("f_lz_plant_small", 36, 27, True)
    ctx.furn("f_lz_floor_lamp", 40, 28, True)
    ctx.furn("f_lz_bench_gold", 34, 30, True)
    ctx.furn("f_lz_bin", 38, 30, True)
    ctx.furn("f_lz_plant", 45, 28, True)
    ctx.furn("f_lz_plant_small", 47, 27, True)
    # Between the two HQ doors — small planter pair, not a barrier.
    ctx.furn("f_lz_plant_small", 53, 28, True)
    ctx.furn("f_lz_plant_small", 55, 28, True)
    # East of right HQ door / main N-S artery (x=56-63), stay on x>=66.
    ctx.furn("f_lz_plant", 66, 28, True)
    ctx.furn("f_lz_floor_lamp", 70, 28, True)
    ctx.furn("f_lz_bench_gold", 68, 30, True)
    ctx.furn("f_lz_plant_small", 72, 27, True)
    ctx.furn("f_lz_plant", 76, 28, True)
    ctx.furn("f_lz_plant_pot", 36, 30, False)

    # ── Place 4: NW rest stop (benches + planters, not a living room) ─────
    # West of main N-S, north of E-W. Open stone around the motif.
    # Bench body is 3×2 — leave ≥1 tile between solids.
    ctx.furn("f_lz_bench_gold", 34, 34, True)
    ctx.furn("f_lz_bench_gold", 40, 36, True)
    ctx.furn("f_lz_plant_small", 37, 34, True)
    ctx.furn("f_lz_plant", 42, 34, True)
    ctx.furn("f_lz_floor_lamp", 32, 34, True)
    ctx.furn("f_lz_plant_pot", 37, 36, False)
    ctx.furn("f_lz_basket", 40, 34, False)

    # ── Place 5: Notice-board corner (mid-west, north of E-W) ─────────────
    # Distinct place between NW rest stop and the main N-S artery.
    ctx.furn("f_lz_board", 48, 34, False)
    ctx.furn("f_lz_poster_grid", 50, 36, False)
    ctx.furn("f_lz_pinboard", 46, 36, False)
    ctx.furn("f_lz_plant_small", 46, 32, True)
    ctx.furn("f_lz_floor_lamp", 50, 32, True)
    ctx.furn("f_lz_crate", 48, 32, True)

    # ── Place 6: NE rest stop (near water cooler 65,33 — do not cover it) ──
    # Cooler body claims ≈64-66,33-34. Stay x>=68. Stay x < 79 (east path).
    ctx.furn("f_lz_bench_gold", 70, 34, True)
    ctx.furn("f_lz_plant_small", 68, 36, True)
    ctx.furn("f_lz_plant_small", 74, 34, True)
    ctx.furn("f_lz_plant", 72, 36, True)
    ctx.furn("f_lz_floor_lamp", 75, 32, True)
    ctx.furn("f_lz_plant_pot", 71, 32, False)
    ctx.furn("f_lz_basket", 68, 32, False)

    # ── Place 7: SW rest stop (west of main N-S, south of E-W) ────────────
    # East of N-S artery band x=34-35 (y>=46 stone). Benches + planters only.
    ctx.furn("f_lz_bench_gold", 38, 50, True)
    ctx.furn("f_lz_plant_small", 36, 50, True)
    ctx.furn("f_lz_plant_small", 41, 50, True)
    ctx.furn("f_lz_plant", 42, 52, True)
    ctx.furn("f_lz_floor_lamp", 36, 54, True)
    ctx.furn("f_lz_bench_gold", 46, 54, True)
    ctx.furn("f_lz_plant_small", 48, 52, True)
    ctx.furn("f_lz_bin", 44, 50, True)
    ctx.furn("f_lz_plant_pot", 40, 54, False)
    ctx.furn("f_lz_crate", 48, 50, True)

    # ── Place 8: SE planted island (east of main N-S, south of E-W) ───────
    # Clear of ground labels (64,50) (69,47) (56,52) and spawn. x < 79 artery.
    ctx.furn("f_lz_palm", 70, 50, True)
    ctx.furn("f_lz_plant_small", 68, 52, True)
    ctx.furn("f_lz_plant_small", 74, 50, True)
    ctx.furn("f_lz_bench_gold", 72, 54, True)
    ctx.furn("f_lz_floor_lamp", 66, 52, True)
    ctx.furn("f_lz_plant_pot", 74, 54, False)

    # ── Place 9: E-W lamp promenade (frame artery y=43-45) ────────────────
    # Deliberate matched lamp posts on y=40 and y=48 only — not a plant
    # sprinkle. Never place solids on y=43/44/45. For x>=81 the north side
    # of the artery is auditorium interior — only frame y=48 there.
    # Portal approach markers (west).
    ctx.furn("f_lz_plant_small", 24, 40, True)
    ctx.furn("f_lz_plant_small", 24, 48, True)
    # Matched lamp pairs stepping east; skip x=54-66 spawn clear zone.
    ctx.furn("f_lz_floor_lamp", 32, 40, True)
    ctx.furn("f_lz_floor_lamp", 32, 48, True)
    ctx.furn("f_lz_floor_lamp", 42, 40, True)
    ctx.furn("f_lz_floor_lamp", 42, 48, True)
    ctx.furn("f_lz_floor_lamp", 50, 40, True)
    ctx.furn("f_lz_floor_lamp", 50, 48, True)
    ctx.furn("f_lz_floor_lamp", 68, 40, True)
    ctx.furn("f_lz_floor_lamp", 68, 48, True)
    ctx.furn("f_lz_floor_lamp", 74, 40, True)
    ctx.furn("f_lz_floor_lamp", 74, 48, True)
    # South of auditorium only (y=48), east of east path — lamp-lined edge.
    ctx.furn("f_lz_floor_lamp", 84, 48, True)
    ctx.furn("f_lz_floor_lamp", 90, 48, True)
    ctx.furn("f_lz_floor_lamp", 96, 48, True)
    ctx.furn("f_lz_floor_lamp", 102, 48, True)

    # ── Place 10: N-S artery gateway markers (corners only) ───────────────
    # Skip y=40-48 around spawn cross. Water cooler already at (65,33).
    ctx.furn("f_lz_plant_small", 54, 30, True)
    ctx.furn("f_lz_plant_small", 65, 30, True)
    ctx.furn("f_lz_floor_lamp", 54, 56, True)
    ctx.furn("f_lz_floor_lamp", 65, 56, True)
    ctx.furn("f_lz_plant_small", 54, 52, True)
    ctx.furn("f_lz_plant_small", 65, 52, True)

    # ── Place 11: East-path gateway (x=78/81 frame, outdoor south of aud) ─
    ctx.furn("f_lz_plant_small", 78, 54, True)
    ctx.furn("f_lz_plant_small", 81, 54, True)
    ctx.furn("f_lz_floor_lamp", 78, 58, True)
    ctx.furn("f_lz_floor_lamp", 81, 58, True)
    ctx.furn("f_lz_plant_small", 78, 50, True)
    ctx.furn("f_lz_plant_small", 81, 50, True)

    # ── Place 12: South plaza promenade (y=56-59 edge walk) ───────────────
    # Rhythm: plant · bench · plant · lamp · plant · bench · (artery gap) …
    ctx.furn("f_lz_plant", 20, 58, True)
    ctx.furn("f_lz_bench_gold", 24, 56, True)
    ctx.furn("f_lz_plant_small", 28, 58, True)
    ctx.furn("f_lz_floor_lamp", 32, 56, True)
    # Was (36,58): plant body claimed artery col x=35. Stay x>=37.
    ctx.furn("f_lz_plant", 38, 58, True)
    ctx.furn("f_lz_bench_gold", 44, 58, True)
    ctx.furn("f_lz_plant_small", 48, 56, True)
    # Leave x=56-63 artery open; resume east.
    ctx.furn("f_lz_plant_small", 68, 58, True)
    ctx.furn("f_lz_bench_gold", 72, 56, True)
    ctx.furn("f_lz_plant", 76, 58, True)
    # East of east path / south of auditorium.
    ctx.furn("f_lz_floor_lamp", 84, 56, True)
    ctx.furn("f_lz_plant_small", 90, 56, True)
    ctx.furn("f_lz_bench_gold", 96, 58, True)
    ctx.furn("f_lz_palm", 100, 56, True)
    ctx.furn("f_lz_floor_lamp", 103, 58, True)
    ctx.furn("f_lz_plant_pot", 36, 56, False)
    ctx.furn("f_lz_pinboard", 40, 56, False)
    ctx.furn("f_lz_poster_grid", 76, 56, False)

    # ── Place 13: SE market + notice corner (south of auditorium) ─────────
    # Auditorium door approach at x=98-99, y=44 — keep a clear south strip.
    # Market-stall vocabulary, not living-room sofas.
    ctx.furn("f_lz_kiosk", 88, 50, True)
    ctx.furn("f_lz_stool_wood", 86, 50, True)
    ctx.furn("f_lz_crate", 91, 52, True)
    ctx.furn("f_lz_boxes", 94, 50, True)
    ctx.furn("f_lz_basket", 86, 52, False)
    ctx.furn("f_lz_basket_lid", 92, 50, False)
    ctx.furn("f_lz_bench_gold", 96, 52, True)
    ctx.furn("f_lz_plant_small", 84, 52, True)
    ctx.furn("f_lz_plant", 102, 54, True)
    ctx.furn("f_lz_poster_grid", 100, 48, False)
    ctx.furn("f_lz_pinboard", 98, 50, False)
    ctx.furn("f_lz_board", 104, 50, False)
    ctx.furn("f_lz_floor_lamp", 102, 52, True)
    ctx.furn("f_lz_plant_pot", 90, 54, False)

    # ── Place 14: West park–plaza seam rest (x=11-20, south of welcome) ───
    # Was (15,50): 32×48 plant overlapped plant_small@16,50.
    ctx.furn("f_lz_plant", 14, 50, True)
    ctx.furn("f_lz_plant_small", 18, 54, True)
    ctx.furn("f_lz_floor_lamp", 20, 52, True)
    ctx.furn("f_lz_bench_gold", 11, 52, True)
    # Was (22,56): palm body overlapped bench_gold@24,56 at col 23.
    ctx.furn("f_lz_palm", 20, 56, True)
    ctx.furn("f_lz_plant_pot", 18, 52, False)
    ctx.furn("f_lz_basket", 12, 54, False)
    ctx.furn("f_lz_plant_small", 16, 56, True)

    # ── Place 15: SW planted pocket (south-west of spawn, open paving) ────
    # x=32 is safe (artery band is x=34-35 for y>=46). Palm body 31-33.
    ctx.furn("f_lz_palm", 32, 54, True)
    ctx.furn("f_lz_plant_small", 32, 52, True)
    ctx.furn("f_lz_board", 28, 50, False)
    ctx.furn("f_lz_poster_grid", 28, 52, False)

    # ── Place 16: South-central rest markers (outside spawn clear radius) ─
    # West of spawn (x<=52) and east of spawn (x>=68), south of E-W.
    ctx.furn("f_lz_bench_gold", 50, 54, True)
    ctx.furn("f_lz_plant_small", 52, 52, True)
    ctx.furn("f_lz_bench_gold", 68, 54, True)
    ctx.furn("f_lz_plant_small", 66, 54, True)

    # ── Non-solid pots only at composed place edges (not mid-field filler)
    ctx.furn("f_lz_plant_pot", 34, 32, False)
    ctx.furn("f_lz_plant_pot", 42, 36, False)
    ctx.furn("f_lz_plant_pot", 24, 36, False)
    ctx.furn("f_lz_plant_pot", 74, 36, False)
    ctx.furn("f_lz_plant_pot", 84, 54, False)
    ctx.furn("f_lz_plant_pot", 100, 54, False)
    ctx.furn("f_lz_plant_pot", 42, 30, False)
    ctx.furn("f_lz_plant_pot", 20, 50, False)
    ctx.furn("f_lz_plant_pot", 50, 52, False)
    ctx.furn("f_lz_plant_pot", 70, 56, False)
    # Open paving around spawn (60,44) and arteries intentionally empty.
