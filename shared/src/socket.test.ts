import { describe, expect, it } from "vitest";
import {
  chatSchema,
  joinSchema,
  meetingCountdownCanceledSchema,
  meetingCountdownSchema,
  meetingEndedSchema,
  meetingParticipantJoinedSchema,
  meetingParticipantLeftSchema,
  meetingStartedSchema,
  moveSchema,
  roomEnterResultSchema,
  roomEnterSchema,
  seatSitSchema,
  seatUpdateSchema,
  socketAuthSchema,
  whisperSchema,
} from "./socket.js";
import { LIMITS, MEETING_CANCEL_REASONS } from "./constants.js";

describe("socket handshake auth", () => {
  it("accepts a non-empty token", () => {
    expect(socketAuthSchema.safeParse({ token: "jwt" }).success).toBe(true);
  });
  it("rejects an empty token", () => {
    expect(socketAuthSchema.safeParse({ token: "" }).success).toBe(false);
  });
});

describe("join", () => {
  it("accepts a spaceId", () => {
    expect(joinSchema.safeParse({ spaceId: "1" }).success).toBe(true);
  });
  it("rejects an empty spaceId", () => {
    expect(joinSchema.safeParse({ spaceId: "" }).success).toBe(false);
  });
  it("rejects an over-long spaceId", () => {
    expect(joinSchema.safeParse({ spaceId: "x".repeat(LIMITS.spaceIdMax + 1) }).success).toBe(false);
  });
});

describe("move", () => {
  it("accepts in-bounds coordinates and a direction", () => {
    expect(moveSchema.safeParse({ x: 10, y: 20, dir: "down" }).success).toBe(true);
  });
  it("rejects an unknown direction", () => {
    expect(moveSchema.safeParse({ x: 10, y: 20, dir: "north" }).success).toBe(false);
  });
  it("rejects negative and non-finite coordinates", () => {
    expect(moveSchema.safeParse({ x: -1, y: 0, dir: "up" }).success).toBe(false);
    expect(moveSchema.safeParse({ x: Infinity, y: 0, dir: "up" }).success).toBe(false);
  });
  it("rejects coordinates beyond the ceiling", () => {
    expect(moveSchema.safeParse({ x: LIMITS.moveCoordMax + 1, y: 0, dir: "up" }).success).toBe(false);
  });
});

describe("chat", () => {
  it("accepts text with an optional scope", () => {
    expect(chatSchema.safeParse({ text: "hi" }).success).toBe(true);
    expect(chatSchema.safeParse({ text: "hi", scope: "world" }).success).toBe(true);
    expect(chatSchema.safeParse({ text: "hi", scope: "room" }).success).toBe(true);
  });
  it("trims and rejects whitespace-only text", () => {
    expect(chatSchema.safeParse({ text: "   " }).success).toBe(false);
  });
  it("rejects an unknown scope", () => {
    expect(chatSchema.safeParse({ text: "hi", scope: "team" }).success).toBe(false);
  });
  it("rejects text past the max length", () => {
    expect(chatSchema.safeParse({ text: "x".repeat(LIMITS.chatTextMax + 1) }).success).toBe(false);
  });
});

describe("whisper", () => {
  it("accepts a target and text", () => {
    expect(whisperSchema.safeParse({ to: "user-1", text: "hey" }).success).toBe(true);
  });
  it("rejects empty target or text", () => {
    expect(whisperSchema.safeParse({ to: "", text: "hey" }).success).toBe(false);
    expect(whisperSchema.safeParse({ to: "user-1", text: "" }).success).toBe(false);
  });
});

describe("room-enter", () => {
  it("accepts a roomId and key", () => {
    expect(roomEnterSchema.safeParse({ roomId: "1", key: "1234" }).success).toBe(true);
  });
  it("rejects a missing key", () => {
    expect(roomEnterSchema.safeParse({ roomId: "1", key: "" }).success).toBe(false);
  });
});

describe("seat-sit", () => {
  it("accepts a non-negative integer seatId", () => {
    expect(seatSitSchema.safeParse({ roomId: "1", seatId: 0 }).success).toBe(true);
  });
  it("rejects a negative or fractional seatId", () => {
    expect(seatSitSchema.safeParse({ roomId: "1", seatId: -1 }).success).toBe(false);
    expect(seatSitSchema.safeParse({ roomId: "1", seatId: 1.5 }).success).toBe(false);
  });
});

describe("server → client shapes", () => {
  it("validates a room-enter-result with an optional reason", () => {
    expect(roomEnterResultSchema.safeParse({ ok: true, roomId: "1" }).success).toBe(true);
    expect(roomEnterResultSchema.safeParse({ ok: false, roomId: "1", reason: "bad-key" }).success).toBe(true);
    expect(roomEnterResultSchema.safeParse({ ok: false, roomId: "1", reason: "nope" }).success).toBe(false);
  });
  it("allows a null playerId on seat-update (a freed seat)", () => {
    expect(seatUpdateSchema.safeParse({ roomId: "1", seatId: 0, playerId: null }).success).toBe(true);
    expect(seatUpdateSchema.safeParse({ roomId: "1", seatId: 0, playerId: "p1" }).success).toBe(true);
  });
});

describe("meeting lifecycle shapes (server → client)", () => {
  const alice = { id: "p1", name: "alice" };
  const bob = { id: "p2", name: "bob" };

  it("validates a meeting-countdown with participants and a positive durationMs", () => {
    expect(
      meetingCountdownSchema.safeParse({ roomId: "1", durationMs: 3000, participants: [alice, bob] }).success,
    ).toBe(true);
  });
  it("rejects a meeting-countdown with a non-positive or fractional durationMs", () => {
    expect(
      meetingCountdownSchema.safeParse({ roomId: "1", durationMs: 0, participants: [alice] }).success,
    ).toBe(false);
    expect(
      meetingCountdownSchema.safeParse({ roomId: "1", durationMs: 1.5, participants: [alice] }).success,
    ).toBe(false);
  });
  it("rejects a countdown participant missing an id or name", () => {
    expect(
      meetingCountdownSchema.safeParse({ roomId: "1", durationMs: 3000, participants: [{ id: "p1" }] }).success,
    ).toBe(false);
  });
  it("validates a meeting-countdown-canceled for each known reason and rejects unknown ones", () => {
    for (const reason of MEETING_CANCEL_REASONS) {
      expect(meetingCountdownCanceledSchema.safeParse({ roomId: "1", reason }).success).toBe(true);
    }
    expect(meetingCountdownCanceledSchema.safeParse({ roomId: "1", reason: "boredom" }).success).toBe(false);
  });
  it("validates a meeting-started with its participant roster", () => {
    expect(meetingStartedSchema.safeParse({ roomId: "1", participants: [alice, bob] }).success).toBe(true);
    expect(meetingStartedSchema.safeParse({ roomId: "1" }).success).toBe(false);
  });
  it("validates a meeting-ended carrying only the roomId", () => {
    expect(meetingEndedSchema.safeParse({ roomId: "1" }).success).toBe(true);
    expect(meetingEndedSchema.safeParse({}).success).toBe(false);
  });
  it("validates a meeting-participant-joined carrying the joiner and the post-join roster", () => {
    expect(
      meetingParticipantJoinedSchema.safeParse({ roomId: "1", participant: bob, participants: [alice, bob] }).success,
    ).toBe(true);
    expect(meetingParticipantJoinedSchema.safeParse({ roomId: "1", participant: bob }).success).toBe(false);
    expect(
      meetingParticipantJoinedSchema.safeParse({ roomId: "1", participant: { id: "p1" }, participants: [] }).success,
    ).toBe(false);
  });
  it("validates a meeting-participant-left by playerId", () => {
    expect(meetingParticipantLeftSchema.safeParse({ roomId: "1", playerId: "p1" }).success).toBe(true);
    expect(meetingParticipantLeftSchema.safeParse({ roomId: "1" }).success).toBe(false);
  });

  it("rejects unknown top-level keys on every meeting schema (strict contract)", () => {
    expect(
      meetingCountdownSchema.safeParse({
        roomId: "1",
        durationMs: 3000,
        participants: [alice],
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      meetingCountdownCanceledSchema.safeParse({ roomId: "1", reason: "stand", extra: true }).success,
    ).toBe(false);
    expect(
      meetingStartedSchema.safeParse({ roomId: "1", participants: [alice], extra: true }).success,
    ).toBe(false);
    expect(meetingEndedSchema.safeParse({ roomId: "1", extra: true }).success).toBe(false);
    expect(
      meetingParticipantJoinedSchema.safeParse({
        roomId: "1",
        participant: alice,
        participants: [alice],
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      meetingParticipantLeftSchema.safeParse({ roomId: "1", playerId: "p1", extra: true }).success,
    ).toBe(false);
  });

  it("rejects unknown keys nested inside a participant", () => {
    const sneaky = { id: "p1", name: "alice", role: "admin" };
    expect(
      meetingCountdownSchema.safeParse({ roomId: "1", durationMs: 3000, participants: [sneaky] }).success,
    ).toBe(false);
    expect(meetingStartedSchema.safeParse({ roomId: "1", participants: [sneaky] }).success).toBe(false);
    expect(
      meetingParticipantJoinedSchema.safeParse({ roomId: "1", participant: sneaky, participants: [alice] })
        .success,
    ).toBe(false);
  });
});
