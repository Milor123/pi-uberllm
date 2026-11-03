// Pure catalog mapping: UberLLM /v1/models entries -> Pi model configs.
//
// This module has no network access and no Pi runtime dependency, so its
// behaviour can be pinned by unit tests. `src/index.ts` owns the I/O.

import type { ProviderChatModelConfig } from "@earendil-works/pi-coding-agent";

/** UberLLM serves Claude on the Anthropic-compatible surface. */
export const ANTHROPIC_MODEL_PREFIX = "anthropic/";

/** Which of UberLLM's two wire surfaces a model is registered on. */
export type Surface = "openai" | "anthropic";

/** Only the fields this extension reads from an UberLLM /v1/models entry. */
export interface UberLLMModel {
  id: string;
  display_name?: string;
  type?: string;
  available?: boolean;
  nsfw?: boolean;
  context_length?: number;
  max_output_tokens?: number;
  input_modalities?: string[];
  supports_reasoning?: boolean;
  supported_parameters?: string[];
  pricing?: {
    input_usd?: number;
    output_usd?: number;
    cache_read_usd?: number | null;
    cache_write_usd?: number | null;
  };
}

/** The catalog split by the surface each model is registered on. */
export interface UberLLMCatalog {
  openAi: ProviderChatModelConfig[];
  anthropic: ProviderChatModelConfig[];
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function surfaceOf(entry: UberLLMModel): Surface {
  return entry.id.startsWith(ANTHROPIC_MODEL_PREFIX) ? "anthropic" : "openai";
}

/**
 * Compatibility flags for the OpenAI-compatible surface.
 *
 * `supportsDeveloperRole: false` is required, not optional. UberLLM rejects
 * OpenAI's `developer` role with
 *   "developer is not one of ['system', 'assistant', 'user', 'tool', 'function']"
 * and Pi auto-detects that flag as enabled for a base URL it does not know.
 */
export function openAiCompat(entry: UberLLMModel): ProviderChatModelConfig["compat"] {
  // UberLLM documents its catalog as OpenRouter-shaped ("tools built for
  // OpenRouter's list read ours as is") and its supported_parameters use
  // OpenRouter's names, so reasoning travels in the OpenRouter wire format.
  //
  // Verified against the live service on every Pi thinking level:
  //   off     -> reasoning:{effort:"none"}      200, 0 reasoning characters
  //   minimal -> reasoning:{effort:"minimal"}   200 (no level error; UberLLM
  //   low/medium/high/xhigh/max                   snaps to the nearest level the
  //                                               model does offer)
  // UberLLM rejects effort:"off" and effort:"disabled" with HTTP 400, but Pi
  // sends "none" for a disabled level, so no thinkingLevelMap is needed: every
  // Pi level maps 1:1. Do not switch this to "openai", which sends
  // reasoning_effort and has no equivalent for a cleanly disabled level.
  const usesOpenRouterReasoning = (entry.supported_parameters ?? []).includes("reasoning");
  const compat: Record<string, unknown> = { supportsDeveloperRole: false };

  if (entry.supports_reasoning && usesOpenRouterReasoning) {
    compat.thinkingFormat = "openrouter";
  }

  return compat as ProviderChatModelConfig["compat"];
}

/** Maps one UberLLM chat entry to a Pi chat model config. */
export function toPiChatModel(entry: UberLLMModel): ProviderChatModelConfig {
  const pricing = entry.pricing ?? {};
  const readsImages = (entry.input_modalities ?? ["text"]).includes("image");

  const model: ProviderChatModelConfig = {
    id: entry.id,
    name: entry.display_name ?? entry.id,
    reasoning: Boolean(entry.supports_reasoning),
    input: readsImages ? ["text", "image"] : ["text"],
    // UberLLM bills cache reads and writes at their own published rates, so
    // Pi's session cost matches the UberLLM bill instead of over-reporting
    // cached tokens at the input rate.
    cost: {
      input: finiteNumber(pricing.input_usd) ?? 0,
      output: finiteNumber(pricing.output_usd) ?? 0,
      cacheRead: finiteNumber(pricing.cache_read_usd) ?? 0,
      cacheWrite: finiteNumber(pricing.cache_write_usd) ?? 0,
    },
    contextWindow: finiteNumber(entry.context_length) ?? 128_000,
    maxTokens: finiteNumber(entry.max_output_tokens) ?? 16_384,
  };

  // `compat` is set per model: the extension provider API exposes it only on a
  // model, and each surface needs its own compatibility shape. The Anthropic
  // surface gets none, so OpenAI-specific flags cannot leak onto it.
  if (surfaceOf(entry) === "openai") {
    model.compat = openAiCompat(entry);
  }

  return model;
}

/** Filters UberLLM's catalog down to chat models Pi can actually call. */
export function buildCatalog(entries: UberLLMModel[]): UberLLMCatalog {
  const models = entries
    // Chat models only: image, video, music, speech and transcription models
    // are served on their own routes and cannot answer /chat/completions.
    .filter((entry) => (entry.type ?? "chat") === "chat")
    // `available: false` means nobody serves it right now (503 on request).
    .filter((entry) => entry.available !== false)
    // Adult/uncensored models, per UberLLM's own nsfw flag.
    .filter((entry) => entry.nsfw !== true)
    .map(toPiChatModel)
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    openAi: models.filter((model) => !model.id.startsWith(ANTHROPIC_MODEL_PREFIX)),
    anthropic: models.filter((model) => model.id.startsWith(ANTHROPIC_MODEL_PREFIX)),
  };
}
