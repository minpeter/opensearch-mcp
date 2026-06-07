const TINYFISH_API_KEY_ENV = "TINYFISH_API_KEY";

let tinyFishApiKeyPoolSource: string | undefined;
let tinyFishApiKeyPool: readonly string[] | undefined;
let tinyFishApiKeyIndex = 0;

export function hasTinyFishApiKeys(): boolean {
  return getTinyFishApiKeyPool().length > 0;
}

export function getTinyFishApiKeyAttemptOrder(): readonly string[] {
  const apiKeys = getTinyFishApiKeyPool();
  if (apiKeys.length === 0) {
    return [];
  }

  const startIndex = tinyFishApiKeyIndex % apiKeys.length;
  tinyFishApiKeyIndex = (startIndex + 1) % apiKeys.length;

  return [...apiKeys.slice(startIndex), ...apiKeys.slice(0, startIndex)];
}

function getTinyFishApiKeyPool(): readonly string[] {
  const apiKeyPoolSource = process.env[TINYFISH_API_KEY_ENV];

  if (
    apiKeyPoolSource !== tinyFishApiKeyPoolSource ||
    tinyFishApiKeyPool === undefined
  ) {
    tinyFishApiKeyPool = (apiKeyPoolSource ?? "")
      .split(";")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    tinyFishApiKeyPoolSource = apiKeyPoolSource;
    tinyFishApiKeyIndex = 0;
  }

  return tinyFishApiKeyPool;
}
