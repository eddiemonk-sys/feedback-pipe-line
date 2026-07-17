// src/util/loadPrompt.ts
import { readFileSync, existsSync } from "node:fs";

type PromptKey = "gate" | "enricher" | "judge" | "threadRouter" | "granolaGate";

function readConfig(): Record<string, string> {
  const configPath = "./prompts/config.yaml";
  if (!existsSync(configPath)) return {};
  const config: Record<string, string> = {};
  for (const line of readFileSync(configPath, "utf8").split("\n")) {
    const colonAt = line.indexOf(":");
    if (colonAt === -1) continue;
    const key = line.slice(0, colonAt).trim();
    const value = line.slice(colonAt + 1).trim();
    if (key && value) config[key] = value;
  }
  return config;
}

/**
 * Reads the active prompt version from `prompts/config.yaml` and loads the file.
 * Returns `undefined` if the config or file is missing (fail-open).
 */
export function loadPrompt(key: PromptKey): string | undefined {
  try {
    const config = readConfig();
    const version = config[key];
    if (!version) return undefined;
    const promptPath = `./prompts/${key}/${version}.md`;
    if (!existsSync(promptPath)) return undefined;
    const content = readFileSync(promptPath, "utf8").trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}
