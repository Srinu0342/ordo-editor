// Ordo's switches: the CONFIG setting, one JSON object read once at start-up.
//
//   CONFIG={"MINI_MAP": false}
//
// Every key is optional and falls back to its default. A key Ordo doesn't
// know, or a value that isn't true or false, stops the server with a message:
// a typo in .env must not quietly leave a switch at its default. The editor
// reads the result from /api/config, under its own names (miniMap).

export type Config = { miniMap: boolean };

export const DEFAULT_CONFIG: Config = { miniMap: true };

// CONFIG's keys, and the switch each one sets.
const KEYS: Record<string, keyof Config> = {
  MINI_MAP: "miniMap",
};

/**
 * CONFIG parsed over the defaults; no CONFIG, or an empty one, is all
 * defaults. Throws when it can't be used, so the caller decides how to stop;
 * server/index.ts prints the message and exits.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const given = env.CONFIG?.trim();
  const config = { ...DEFAULT_CONFIG };
  if (!given) return config;

  let parsed: unknown;
  try {
    parsed = JSON.parse(given);
  } catch {
    throw new Error(`CONFIG is not valid JSON: ${given}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`CONFIG must be a JSON object, like {"MINI_MAP": false}`);

  for (const [key, value] of Object.entries(parsed)) {
    const name = Object.hasOwn(KEYS, key) ? KEYS[key] : undefined;
    if (!name) throw new Error(`CONFIG has no setting ${key}; it knows ${Object.keys(KEYS).join(", ")}`);
    if (typeof value !== "boolean") throw new Error(`CONFIG's ${key} must be true or false, not ${JSON.stringify(value)}`);
    config[name] = value;
  }
  return config;
}
