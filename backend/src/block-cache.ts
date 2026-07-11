/**
 * Process-wide block-pair cache (PRD 25.13), bound to the real Postgres loader.
 * Kept out of `blocks.ts` so the pure `BlockCache` stays service-free for unit
 * tests. Imported by the REST endpoints (mutations) and the socket layer
 * (delivery filtering + per-connection load).
 */
import { BlockCache } from "./blocks.js";
import { listBlockedIds, listBlockerIds } from "./repository.js";

export const blocks = new BlockCache({ listBlockedIds, listBlockerIds });
