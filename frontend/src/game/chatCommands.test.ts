import { describe, expect, it } from "vitest";
import { CHAT_COMMANDS, commandInsertion, commandSuggestions } from "./chatCommands";

function commandByName(name: string) {
  const command = CHAT_COMMANDS.find((entry) => entry.name === name);
  if (!command) throw new Error(`missing chat command ${name}`);
  return command;
}

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
    expect(commandInsertion(commandByName("/msg"))).toBe("/msg ");
    expect(commandInsertion(commandByName("/map"))).toBe("/map");
  });
});
