// Unit tests for the pure catalog mapping.
//
// These pin the behaviour that manual testing against the live service cannot
// cover reliably: the filters, the surface split, the cost mapping and the
// compatibility flags. Run with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCatalog,
  openAiCompat,
  surfaceOf,
  toPiChatModel,
  type UberLLMModel,
} from "../src/catalog.ts";

function entry(overrides: Partial<UberLLMModel> & { id: string }): UberLLMModel {
  return overrides;
}

test("keeps only chat models that are available and not nsfw", () => {
  const catalog = buildCatalog([
    entry({ id: "vendor/good" }),
    entry({ id: "vendor/video-model", type: "video" }),
    entry({ id: "vendor/sold-out", available: false }),
    entry({ id: "vendor/adult", nsfw: true }),
  ]);

  const ids = [...catalog.openAi, ...catalog.anthropic].map((model) => model.id);
  assert.deepEqual(ids, ["vendor/good"]);
});

test("routes anthropic/* to the Anthropic surface and everything else to the OpenAI surface", () => {
  const catalog = buildCatalog([
    entry({ id: "anthropic/claude-sonnet-5" }),
    entry({ id: "deepseek/deepseek-v4-flash" }),
    entry({ id: "z-ai/glm-5.3" }),
  ]);

  assert.deepEqual(
    catalog.anthropic.map((model) => model.id),
    ["anthropic/claude-sonnet-5"],
  );
  assert.deepEqual(
    catalog.openAi.map((model) => model.id),
    ["deepseek/deepseek-v4-flash", "z-ai/glm-5.3"],
  );
});

test("disables OpenAI's developer role on every OpenAI-surface model and leaves the Anthropic surface clean", () => {
  const catalog = buildCatalog([
    entry({ id: "anthropic/claude-sonnet-5" }),
    entry({ id: "deepseek/deepseek-v4-flash" }),
    entry({ id: "openai/gpt-5", supports_reasoning: true, supported_parameters: ["reasoning"] }),
  ]);

  for (const model of catalog.openAi) {
    assert.equal(
      (model.compat as Record<string, unknown>).supportsDeveloperRole,
      false,
      `${model.id} must disable the developer role`,
    );
  }
  assert.equal(catalog.anthropic[0].compat, undefined);
});

test("maps UberLLM cache pricing into Pi cost so the session total matches the bill", () => {
  const model = toPiChatModel(
    entry({
      id: "anthropic/claude-sonnet-5",
      pricing: {
        input_usd: 1.06,
        output_usd: 5.3,
        cache_read_usd: 0.106,
        cache_write_usd: 1.325,
      },
    }),
  );

  assert.deepEqual(model.cost, {
    input: 1.06,
    output: 5.3,
    cacheRead: 0.106,
    cacheWrite: 1.325,
  });
});

test("treats a null cache price as free instead of propagating null", () => {
  const model = toPiChatModel(
    entry({
      id: "vendor/no-cache-pricing",
      pricing: { input_usd: 1, output_usd: 2, cache_read_usd: null, cache_write_usd: null },
    }),
  );

  assert.deepEqual(model.cost, { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
});

test("uses the OpenRouter thinking format only when the model advertises reasoning", () => {
  const advertised = openAiCompat(entry({ id: "a/b", supports_reasoning: true, supported_parameters: ["reasoning"] }));
  assert.equal((advertised as Record<string, unknown>).thinkingFormat, "openrouter");

  const notAdvertised = openAiCompat(entry({ id: "a/b", supports_reasoning: true, supported_parameters: ["tools"] }));
  assert.equal((notAdvertised as Record<string, unknown>).thinkingFormat, undefined);
  assert.equal((notAdvertised as Record<string, unknown>).supportsDeveloperRole, false);

  const notReasoning = openAiCompat(entry({ id: "a/b", supports_reasoning: false, supported_parameters: ["reasoning"] }));
  assert.equal((notReasoning as Record<string, unknown>).thinkingFormat, undefined);
});

test("defaults missing metadata instead of throwing", () => {
  const model = toPiChatModel(entry({ id: "vendor/bare" }));

  assert.equal(model.name, "vendor/bare");
  assert.equal(model.reasoning, false);
  assert.deepEqual(model.input, ["text"]);
  assert.equal(model.contextWindow, 128_000);
  assert.equal(model.maxTokens, 16_384);
  assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("marks image input and sorts the catalog by id", () => {
  const catalog = buildCatalog([
    entry({ id: "vendor/zeta" }),
    entry({ id: "vendor/alpha", input_modalities: ["text", "image"] }),
  ]);

  assert.deepEqual(
    catalog.openAi.map((model) => model.id),
    ["vendor/alpha", "vendor/zeta"],
  );
  assert.deepEqual(catalog.openAi[0].input, ["text", "image"]);
  assert.deepEqual(catalog.openAi[1].input, ["text"]);
});

test("surfaceOf classifies by the anthropic vendor prefix", () => {
  assert.equal(surfaceOf(entry({ id: "anthropic/claude-opus-5.5" })), "anthropic");
  assert.equal(surfaceOf(entry({ id: "deepseek/deepseek-v4-flash" })), "openai");
});
