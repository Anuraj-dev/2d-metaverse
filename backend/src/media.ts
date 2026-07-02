import { RoomServiceClient } from "livekit-server-sdk";
import { config } from "./config.js";
import { childLogger } from "./logger.js";

const log = childLogger({ module: "media" });

const rooms = new RoomServiceClient(config.liveKitApiUrl, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

export async function removeMediaParticipant(roomName: string, identity: string): Promise<void> {
  try {
    await rooms.removeParticipant(roomName, identity);
  } catch (error) {
    // A participant who never connected, already left, or whose room expired needs no cleanup.
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|does not exist|404/i.test(message)) {
      log.warn({ roomName, identity, message }, "LiveKit participant cleanup failed");
    }
  }
}
