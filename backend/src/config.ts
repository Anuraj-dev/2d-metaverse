import "dotenv/config";
import { logger } from "./logger.js";
import { ConfigError, parseConfig, type AppConfig } from "./parse-config.js";

export type { AppConfig } from "./parse-config.js";

function loadConfig(): AppConfig {
  try {
    return parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      if (error.detail) logger.fatal({ issues: error.detail }, error.message);
      else logger.fatal(error.message);
    } else {
      logger.fatal({ err: error }, "invalid environment configuration");
    }
    process.exit(1);
  }
}

export const config = loadConfig();
