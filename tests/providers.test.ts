import { describe, expect, it } from "vitest";
import { PROVIDERS, getProvider, validateProviderBaseUrl } from "../shared/providers.js";

describe("provider catalog and endpoints", () => {
  it("provides explicit API and local choices with official documentation", () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(expect.arrayContaining([
      "openai", "anthropic", "gemini", "groq", "mistral", "deepseek",
      "openrouter", "xai", "together", "fireworks", "cerebras", "ollama", "custom",
    ]));
    expect(new Set(PROVIDERS.map((provider) => provider.id)).size).toBe(PROVIDERS.length);
    expect(getProvider("anthropic").protocol).toBe("anthropic");
    expect(getProvider("ollama").requiresKey).toBe(false);
    for (const provider of PROVIDERS) expect(provider.docsUrl).toMatch(/^https:\/\//);
    expect(() => getProvider("not-a-provider")).toThrow(/provider/i);
  });

  it.each([
    "http://api.example.com/v1", "file:///tmp/key", "https://user:pass@example.com/v1",
    "https://example.com/v1?key=secret", "https://example.com/v1#secret", "not a URL",
    "http://localhost.evil.example/v1", "http://192.168.1.5/v1", "http://0.0.0.0/v1",
  ])("rejects an unsafe or credential-bearing endpoint: %s", (url) => {
    expect(() => validateProviderBaseUrl(url)).toThrow();
  });

  it.each(["https://api.example.com/v1", "http://127.0.0.1:11434/v1", "http://localhost:1234/v1", "http://[::1]:11434/v1"])(
    "allows HTTPS or a literal loopback endpoint: %s", (url) => {
      expect(validateProviderBaseUrl(`${url}/`)).toBe(url);
    },
  );
});
