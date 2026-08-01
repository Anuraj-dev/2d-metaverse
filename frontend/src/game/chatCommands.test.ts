import { describe, expect, it } from "vitest";
import { CHAT_COMMANDS, commandInsertion, commandSuggestions } from "./chatCommands";

describe("chat command discovery", () => {
  it("shows every command for a bare slash", () => {
    expect(commandSuggestions("/")).toEqual(CHAT_COMMANDS);
  });

  it("filters by the typed command prefix", () => {
    expect(commandSuggestions("/m").map((command) => command.name)).toEqual([
      "/map",
      "/msg",
      "/mute",
    ]);
  });

  it("closes discovery after the command token", () => {
    expect(commandSuggestions("/msg ")).toEqual([]);
    expect(commandSuggestions("hello")).toEqual([]);
  });

  it("adds a writing space only when a command accepts arguments", () => {
    expect(commandInsertion(CHAT_COMMANDS.find((command) => command.name === "/msg")!)).toBe("/msg ");
    expect(commandInsertion(CHAT_COMMANDS.find((command) => command.name === "/map")!)).toBe("/map");
  });
});
