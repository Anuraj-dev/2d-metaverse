/**
 * `@metaverse/shared` — the single source of truth for every socket event and REST
 * payload shape exchanged between the frontend and backend.
 *
 * Rule: payload shapes are defined here ONLY. The backend imports the schemas for
 * runtime validation; the frontend imports the inferred types (and the event-name
 * / limit constants). Never re-declare a wire shape in either package.
 */
export * from "./constants.js";
export * from "./socket.js";
export * from "./rest.js";
export * from "./geometry.js";
export * from "./games/board.js";
export * from "./games/ticTacToe.js";
export * from "./games/connect4.js";
export * from "./games/rules.js";
