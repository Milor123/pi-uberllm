// UberLLM provider extension for Pi (@earendil-works/pi-coding-agent).
//
// Registers UberLLM's live chat catalog as two Pi providers, read from
// `GET https://api.uberllm.dev/v1/models` (public, no key required):
//
//   uberllm            OpenAI-compatible surface    https://api.uberllm.dev/v1
//   uberllm-anthropic  Anthropic-compatible surface https://api.uberllm.dev
//
// The split is not cosmetic. Anthropic-style prompt caching needs
// `cache_control` markers on the request; Pi emits those itself on the
// anthropic-messages API and does not on the OpenAI-compatible one. Routing
// Claude through /v1/messages keeps caching in Pi's hands instead of trusting
// the aggregator to inject it. UberLLM bills cache reads and writes at its own
// published rates, and src/catalog.ts maps both into the model cost.
//
// API key: the UBERLLM_API_KEY environment variable, or /login for
// provider "uberllm". The key is never written into a config file.
//
// Compatibility flags live in src/catalog.ts and are limited to differences
// observed against the live service. Pi's guidance is not to enable them
// because an endpoint claims compatibility, so add one only alongside the
// failure it fixes.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildCatalog, type UberLLMCatalog, type UberLLMModel } from "./catalog";

const API_ROOT = "https://api.uberllm.dev";
const OPENAI_BASE_URL = `${API_ROOT}/v1`;
const ANTHROPIC_BASE_URL = API_ROOT;
const MODELS_URL = `${API_ROOT}/v1/models`;

const KEY_ENV = "UBERLLM_API_KEY";
const OPENAI_PROVIDER_ID = "uberllm";
const ANTHROPIC_PROVIDER_ID = "uberllm-anthropic";

const REQUEST_TIMEOUT_MS = 15_000;
const CATALOG_TTL_MS = 60_000;

interface FetchedCatalog extends UberLLMCatalog {
  fetchedAt: number;
}

let cachedCatalog: FetchedCatalog | undefined;

/** Reads UberLLM's live chat catalog. */
async function fetchCatalog(signal: AbortSignal): Promise<FetchedCatalog> {
  const response = await fetch(MODELS_URL, { signal, headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`UberLLM ${MODELS_URL} answered HTTP ${response.status}`);
  }

  const body = (await response.json()) as { data?: UberLLMModel[] };
  return { ...buildCatalog(body.data ?? []), fetchedAt: Date.now() };
}

/**
 * Shared catalog loader. Both providers reuse one network call within the TTL,
 * so a model-list refresh does not hit the public endpoint twice.
 */
async function loadCatalog(signal: AbortSignal, force = false): Promise<FetchedCatalog> {
  if (!force && cachedCatalog && Date.now() - cachedCatalog.fetchedAt < CATALOG_TTL_MS) {
    return cachedCatalog;
  }

  try {
    cachedCatalog = await fetchCatalog(signal);
    return cachedCatalog;
  } catch (error) {
    // A transient failure must not drop a catalog we already have. Pi aborts
    // a model-catalog refresh after 15 seconds, and one slow provider can
    // take that abort out on the others, so serving the last good catalog
    // keeps this provider usable instead of empty.
    if (cachedCatalog) {
      console.warn(`[uberllm] catalog refresh failed, serving cached catalog: ${String(error)}`);
      return cachedCatalog;
    }
    throw error;
  }
}

export default async function uberllm(pi: ExtensionAPI): Promise<void> {
  // Fetch once at load time so the catalog is available to startup model
  // selection and to `pi --list-models`, matching the documented pattern.
  let initial: FetchedCatalog | undefined;
  try {
    initial = await loadCatalog(AbortSignal.timeout(REQUEST_TIMEOUT_MS), true);
  } catch (error) {
    // A failed startup fetch must not break Pi: the providers still register
    // with an empty list and recover on the next refresh.
    console.warn(`[uberllm] startup catalog fetch failed: ${String(error)}`);
  }

  const register = (catalog: FetchedCatalog | undefined): void => {
    pi.registerProvider(OPENAI_PROVIDER_ID, {
      name: "UberLLM",
      baseUrl: OPENAI_BASE_URL,
      api: "openai-completions",
      apiKey: `$${KEY_ENV}`,
      models: catalog?.openAi ?? [],
      refreshModels: async (context) => (await loadCatalog(context.signal)).openAi,
    });

    pi.registerProvider(ANTHROPIC_PROVIDER_ID, {
      name: "UberLLM (Anthropic)",
      baseUrl: ANTHROPIC_BASE_URL,
      api: "anthropic-messages",
      apiKey: `$${KEY_ENV}`,
      models: catalog?.anthropic ?? [],
      refreshModels: async (context) => (await loadCatalog(context.signal)).anthropic,
    });
  };

  register(initial);

  // Re-read the catalog on every session start, so a newly listed model shows
  // up without restarting Pi. `registerProvider` after init applies at once.
  pi.on("session_start", async (_event, ctx) => {
    try {
      const catalog = await loadCatalog(AbortSignal.timeout(REQUEST_TIMEOUT_MS), true);
      register(catalog);
    } catch (error) {
      if (initial) return; // Keep the startup catalog; nothing to report.
      ctx.ui.notify(`UberLLM: model catalog unavailable (${String(error)})`, "warning");
    }
  });
}
