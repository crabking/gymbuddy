import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";

// Env-configurable LLM backend. Pick a provider and plug in your own key:
//
//   AI_PROVIDER  — "openai" (default; any OpenAI-compatible endpoint) or "anthropic".
//   AI_API_KEY   — key for the chosen provider.
//   AI_MODEL     — model id as that provider expects it.
//   AI_BASE_URL  — (openai only) override the base URL (OpenAI, OpenRouter, Groq, …).
//
// Examples:
//   OpenAI     → AI_PROVIDER=openai    AI_API_KEY=sk-...      AI_MODEL=gpt-5.5
//   Anthropic  → AI_PROVIDER=anthropic AI_API_KEY=sk-ant-...  AI_MODEL=claude-sonnet-5
const DEFAULTS = {
  openai: { baseURL: "https://api.openai.com/v1", model: "gpt-5.5" },
  anthropic: { model: "claude-sonnet-5" },
};

export function getAiProviderMetadata() {
  const provider = (process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  return {
    provider: provider === "anthropic" ? "anthropic" : "openai-compatible",
    model:
      process.env.AI_MODEL?.trim() ||
      (provider === "anthropic" ? DEFAULTS.anthropic.model : DEFAULTS.openai.model),
  };
}

/** Build the chat model from env config. Throws if AI_API_KEY is missing. */
export function getChatModel() {
  const provider = (process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("Missing AI_API_KEY environment variable");

  if (provider === "anthropic") {
    const anthropic = createAnthropic({ apiKey });
    return anthropic(process.env.AI_MODEL?.trim() || DEFAULTS.anthropic.model);
  }

  // Default: any OpenAI-compatible endpoint.
  const openai = createOpenAICompatible({
    name: "ai",
    baseURL: process.env.AI_BASE_URL?.trim() || DEFAULTS.openai.baseURL,
    apiKey,
    supportsStructuredOutputs: false,
  });
  return openai(process.env.AI_MODEL?.trim() || DEFAULTS.openai.model);
}
