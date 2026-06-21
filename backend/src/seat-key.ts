export interface SeatRef { roomId: string; seatId: number }

export function parseSeatKey(key: string): SeatRef | null {
  const match = /^seat:([^:]+):(\d+)$/.exec(key);
  return match?.[1] && match[2] ? { roomId: match[1], seatId: Number(match[2]) } : null;
}
