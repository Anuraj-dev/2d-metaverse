export interface ChatCommand {
  name: string;
  usage: string;
  description: string;
  takesArguments: boolean;
}

/** The single source of truth for chat help, discovery, and completion. */
export const CHAT_COMMANDS: readonly ChatCommand[] = [
  { name: "/all", usage: "/all <message>", description: "Message everyone", takesArguments: true },
  { name: "/help", usage: "/help", description: "Show command help", takesArguments: false },
  { name: "/map", usage: "/map", description: "Open the campus map", takesArguments: false },
  { name: "/msg", usage: "/msg <name> <message>", description: "Whisper to a player", takesArguments: true },
  { name: "/mute", usage: "/mute <name>", description: "Mute a player this session", takesArguments: true },
  { name: "/reply", usage: "/reply <message>", description: "Reply to your last whisper", takesArguments: true },
  { name: "/room", usage: "/room <message>", description: "Message this private area", takesArguments: true },
  { name: "/unmute", usage: "/unmute <name>", description: "Unmute a player", takesArguments: true },
  { name: "/w", usage: "/w <name> <message>", description: "Short alias for /msg", takesArguments: true },
] as const;

/** Suggestions are visible only while editing the command token itself. */
export function commandSuggestions(text: string): readonly ChatCommand[] {
  if (!text.startsWith("/") || /\s/.test(text)) return [];
  const query = text.toLowerCase();
  return CHAT_COMMANDS.filter((command) => command.name.startsWith(query));
}

export function commandInsertion(command: ChatCommand): string {
  return command.takesArguments ? `${command.name} ` : command.name;
}

export const CHAT_HELP = [
  "Commands:",
  ...CHAT_COMMANDS.map((command) => `${command.usage} — ${command.description}`),
  "Enter or T focuses chat · Esc returns to the game",
] as const;
