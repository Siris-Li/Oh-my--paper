import { createAnthropicProvider } from "./anthropic.mjs";
import { createOpenAIProvider } from "./openai.mjs";

export function loadProvider(providerConfig) {
  switch (providerConfig.vendor) {
    case "openai":
    case "openrouter":
    case "deepseek":
      return createOpenAIProvider(providerConfig);
    case "anthropic":
    case "custom":
    case "google":
    default:
      return createAnthropicProvider(providerConfig);
  }
}
