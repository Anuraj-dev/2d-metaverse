import { describe, expect, it } from "vitest";
import {
  boardAcceptSchema,
  boardErrorSchema,
  boardMoveSchema,
  boardSitSchema,
  boardUpdateSchema,
  chatSchema,
  joinSchema,
  meetingChatMessageSchema,
  meetingChatSchema,
  meetingCountdownCanceledSchema,
  meetingCountdownSchema,
  meetingEndedSchema,
  meetingParticipantJoinedSchema,
  meetingParticipantLeftSchema,
  meetingStartedSchema,
  moveSchema,
  adminChangedSchema,
  approveKnockSchema,
  cancelKnockSchema,
  capacityAlertSchema,
  knockPendingSchema,
  knockResultSchema,
  knockSchema,
  roomOpenStateSchema,
  toggleAllowAllSchema,
  seatSitSchema,
  seatUpdateSchema,
  socketAuthSchema,
  whisperSchema,
} from "./socket.js";
import { BOARD_MOVE_REJECTIONS, LIMITS, MEETING_CANCEL_REASONS } from "./constants.js";

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

describe("room access — knock/approve (PRD 14)", () => {
  it("accepts a knock with just a roomId", () => {
    expect(knockSchema.safeParse({ roomId: "1" }).success).toBe(true);
    expect(cancelKnockSchema.safeParse({ roomId: "1" }).success).toBe(true);
  });
  it("rejects a knock with an empty roomId or an extra key field", () => {
    expect(knockSchema.safeParse({ roomId: "" }).success).toBe(false);
    // strict: no legacy `key` allowed
    expect(knockSchema.safeParse({ roomId: "1", key: "1234" }).success).toBe(false);
  });
  it("accepts approve/deny carrying the target playerId", () => {
    expect(approveKnockSchema.safeParse({ roomId: "1", playerId: "p2" }).success).toBe(true);
    expect(approveKnockSchema.safeParse({ roomId: "1", playerId: "" }).success).toBe(false);
    expect(approveKnockSchema.safeParse({ roomId: "1" }).success).toBe(false);
  });
  it("accepts a boolean allow-all toggle only", () => {
    expect(toggleAllowAllSchema.safeParse({ roomId: "1", allowAll: true }).success).toBe(true);
    expect(toggleAllowAllSchema.safeParse({ roomId: "1", allowAll: "yes" }).success).toBe(false);
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
  it("validates the knock-pending queue and its requesters", () => {
    expect(knockPendingSchema.safeParse({ roomId: "1", knocks: [] }).success).toBe(true);
    expect(knockPendingSchema.safeParse({ roomId: "1", knocks: [{ id: "p2", name: "Bo" }] }).success).toBe(true);
    expect(knockPendingSchema.safeParse({ roomId: "1", knocks: [{ id: "p2" }] }).success).toBe(false);
  });
  it("validates a knock-result outcome, rejecting unknown outcomes", () => {
    expect(knockResultSchema.safeParse({ roomId: "1", result: "approved" }).success).toBe(true);
    expect(knockResultSchema.safeParse({ roomId: "1", result: "timeout" }).success).toBe(true);
    // `canceled` is client-initiated and never sent back
    expect(knockResultSchema.safeParse({ roomId: "1", result: "canceled" }).success).toBe(false);
  });
  it("validates admin-changed with a nullable admin and a known reason", () => {
    expect(adminChangedSchema.safeParse({ roomId: "1", admin: { id: "a", name: "A" }, reason: "initial" }).success).toBe(true);
    expect(adminChangedSchema.safeParse({ roomId: "1", admin: null, reason: "succession" }).success).toBe(true);
    expect(adminChangedSchema.safeParse({ roomId: "1", admin: null, reason: "poof" }).success).toBe(false);
  });
  it("validates room-open-state and capacity-alert", () => {
    expect(roomOpenStateSchema.safeParse({ roomId: "1", allowAll: true, atCapacity: false }).success).toBe(true);
    expect(roomOpenStateSchema.safeParse({ roomId: "1", allowAll: true }).success).toBe(false);
    expect(capacityAlertSchema.safeParse({ roomId: "1" }).success).toBe(true);
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

describe("in-meeting chat (PRD 10)", () => {
  it("accepts a client → server line carrying only text", () => {
    expect(meetingChatSchema.safeParse({ text: "hello" }).success).toBe(true);
  });
  it("trims and rejects whitespace-only text", () => {
    expect(meetingChatSchema.safeParse({ text: "   " }).success).toBe(false);
  });
  it("rejects text past the shared chat cap", () => {
    expect(meetingChatSchema.safeParse({ text: "x".repeat(LIMITS.chatTextMax + 1) }).success).toBe(false);
    expect(meetingChatSchema.safeParse({ text: "x".repeat(LIMITS.chatTextMax) }).success).toBe(true);
  });
  it("rejects a spoofed roomId or any extra key (strict contract)", () => {
    expect(meetingChatSchema.safeParse({ text: "hi", roomId: "1" }).success).toBe(false);
    expect(meetingChatSchema.safeParse({ text: "hi", extra: true }).success).toBe(false);
  });
  it("validates the server → client relayed line and rejects missing / extra fields", () => {
    expect(
      meetingChatMessageSchema.safeParse({ roomId: "1", id: "p1", name: "alice", text: "hi" }).success,
    ).toBe(true);
    expect(meetingChatMessageSchema.safeParse({ roomId: "1", id: "p1", name: "alice" }).success).toBe(false);
    expect(
      meetingChatMessageSchema.safeParse({ roomId: "1", id: "p1", name: "alice", text: "hi", extra: true })
        .success,
    ).toBe(false);
  });
});

describe("board-game client → server shapes", () => {
  it("accepts a valid board-sit and rejects an unknown table / bad seat", () => {
    expect(boardSitSchema.safeParse({ tableId: "ttt-1", seat: 0 }).success).toBe(true);
    expect(boardSitSchema.safeParse({ tableId: "c4-1", seat: 1 }).success).toBe(true);
    expect(boardSitSchema.safeParse({ tableId: "nope", seat: 0 }).success).toBe(false);
    expect(boardSitSchema.safeParse({ tableId: "ttt-1", seat: 2 }).success).toBe(false);
    expect(boardSitSchema.safeParse({ tableId: "ttt-1", seat: -1 }).success).toBe(false);
    expect(boardSitSchema.safeParse({ tableId: "ttt-1", seat: 0, extra: 1 }).success).toBe(false);
  });

  it("accepts a valid board-move and rejects out-of-range / non-integer indices", () => {
    expect(boardMoveSchema.safeParse({ tableId: "ttt-1", index: 8 }).success).toBe(true);
    expect(boardMoveSchema.safeParse({ tableId: "ttt-1", index: -1 }).success).toBe(false);
    expect(boardMoveSchema.safeParse({ tableId: "ttt-1", index: LIMITS.boardMoveIndexMax + 1 }).success).toBe(false);
    expect(boardMoveSchema.safeParse({ tableId: "ttt-1", index: 1.5 }).success).toBe(false);
  });

  it("accepts a valid board-accept and rejects unknown keys", () => {
    expect(boardAcceptSchema.safeParse({ tableId: "c4-1" }).success).toBe(true);
    expect(boardAcceptSchema.safeParse({ tableId: "c4-1", extra: true }).success).toBe(false);
  });
});

describe("board-game server → client shapes", () => {
  const occupant = { id: "p1", name: "alice", accepted: true };
  const liveState = { board: [0, 1, 2, 0, 0, 0, 0, 0, 0], turn: 2, result: { status: "in_progress" } };

  it("validates a full active-phase snapshot", () => {
    expect(
      boardUpdateSchema.safeParse({
        tableId: "ttt-1",
        game: "tictactoe",
        phase: "active",
        seats: [occupant, { id: "p2", name: "bob", accepted: true }],
        state: liveState,
        reason: null,
      }).success,
    ).toBe(true);
  });

  it("validates a waiting snapshot with an empty seat and no state", () => {
    expect(
      boardUpdateSchema.safeParse({
        tableId: "c4-1",
        game: "connect4",
        phase: "waiting",
        seats: [occupant, null],
        state: null,
        reason: null,
      }).success,
    ).toBe(true);
  });

  it("rejects a bad phase, bad cell value, and unknown keys", () => {
    expect(
      boardUpdateSchema.safeParse({
        tableId: "ttt-1",
        game: "tictactoe",
        phase: "paused",
        seats: [null, null],
        state: null,
        reason: null,
      }).success,
    ).toBe(false);
    expect(
      boardUpdateSchema.safeParse({
        tableId: "ttt-1",
        game: "tictactoe",
        phase: "active",
        seats: [occupant, occupant],
        state: { board: [3], turn: 1, result: { status: "in_progress" } },
        reason: null,
      }).success,
    ).toBe(false);
    expect(
      boardUpdateSchema.safeParse({
        tableId: "ttt-1",
        game: "tictactoe",
        phase: "waiting",
        seats: [null, null],
        state: null,
        reason: null,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("validates every rejection reason and rejects unknown ones", () => {
    for (const reason of BOARD_MOVE_REJECTIONS) {
      expect(boardErrorSchema.safeParse({ tableId: "ttt-1", reason }).success).toBe(true);
    }
    expect(boardErrorSchema.safeParse({ tableId: "ttt-1", reason: "meh" }).success).toBe(false);
  });
});
