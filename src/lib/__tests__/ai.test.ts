/**
 * The bring-your-own-key layer: key detection, the dry check, model rotation, the reply
 * parser and the merge rules that keep AI-filled figures labelled and subordinate to
 * anything a published board says.
 *
 * Every provider call here is a fake `fetch`, so the shape of each dialect (Gemini,
 * OpenAI-compatible, Anthropic) is asserted without a network - which is also the only way
 * this can run in CI, where no real key exists.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { checkKey, chat, errorHint, errorMessage, listModels, redact } from '../ai/client';
import { boardPrompt, coerceRow, extractJsonArray, extractRows, picksForSearch, toIsoInstant, toNumber } from '../ai/extract';
import { aiBoardSearch, aiIdleStatus, aiSourceStatus } from '../ai/search';
import {
  MODEL_ATTEMPT_LIMIT,
  candidatesForKey,
  detectProvider,
  looksLikeKey,
  modelVersion,
  pickModel,
  providerSpec,
  rankModels,
  selectableModels,
} from '../ai/providers';
import { emptyParsedLive, SENTINEL_YEAR } from '../live/parse';
import { mergeAiResult } from '../live';
import { IPOT } from '../ipoData';
import type { IPO } from '../types';

/* ------------------------------------------------------------------- helpers */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

interface Route {
  match: RegExp;
  status?: number;
  json?: unknown;
  text?: string;
  /** called for every match, so a test can answer differently on the second call */
  once?: boolean;
}

/** Minimal fetch that answers from a route table and records what was sent. */
function fakeFetch(routes: Route[], calls: Call[] = []): { fetcher: typeof fetch; calls: Call[] } {
  const used = new Set<number>();
  const fetcher = (async (url: string, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: String(init?.method ?? 'GET'),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    const index = routes.findIndex((route, position) => route.match.test(call.url) && !(route.once && used.has(position)));
    if (index === -1) {
      return { ok: false, status: 404, text: async () => '{"error":{"message":"no route"}}' } as unknown as Response;
    }
    used.add(index);
    const route = routes[index];
    const body = route.text ?? JSON.stringify(route.json ?? {});
    const status = route.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const geminiModels = {
  models: [
    { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
  ],
};

/** What Google really answers for a retired model name (verbatim shape, trimmed). */
const RETIRED = (model: string, replacement: string) => ({
  error: {
    message: `This model models/${model} is no longer available to new users. Please update your code to use models/${replacement} for the latest features and improvements.`,
    status: 'NOT_FOUND',
  },
});

const geminiReply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

/* -------------------------------------------------------------- key shapes */

test('a key is recognised by its shape, whichever vendor it came from', () => {
  assert.equal(detectProvider('AIzaSyD-1234567890abcdefghijklmnopqrs')?.id, 'gemini');
  assert.equal(detectProvider('sk-ant-api03-abcdefghijklmnop')?.id, 'anthropic');
  assert.equal(detectProvider('sk-or-v1-abcdefghijklmnop')?.id, 'openrouter');
  assert.equal(detectProvider('gsk_abcdefghijklmnopqrst')?.id, 'groq');
  assert.equal(detectProvider('xai-abcdefghijklmnopqrst')?.id, 'xai');
  assert.equal(detectProvider('nvapi-abcdefghijklmnopqrst')?.id, 'nvidia');
  assert.equal(detectProvider('pplx-abcdefghijklmnopqrst')?.id, 'perplexity');
  assert.equal(detectProvider('csk-abcdefghijklmnopqrst')?.id, 'cerebras');
  // the ambiguous shapes keep every option open, ordered by likelihood
  assert.deepEqual(
    candidatesForKey('sk-abcdefghijklmnopqrst').map((spec) => spec.id),
    ['openai', 'deepseek', 'together', 'custom']
  );
  assert.equal(candidatesForKey('AKIAIOSFODNN7EXAMPLE12')[0].id, 'mistral');
});

test('a pasted sentence is never mistaken for a key', () => {
  assert.equal(looksLikeKey('AIzaSyD-1234567890abcdefghijklmnopqrs'), true);
  assert.equal(looksLikeKey('my key is AIzaSyD-1234567890abcdefg'), false, 'spaces');
  assert.equal(looksLikeKey('sk-short'), false, 'too short');
  assert.equal(detectProvider('hello world, please use my account'), null);
});

test('model choice skips embedding models and honours an explicit pick', () => {
  const models = ['models/embedding-001', 'models/gemini-1.5-pro', 'models/gemini-2.5-flash-lite'];
  const gemini = candidatesForKey('AIzaSyD-1234567890abcdefghijklmnopqrs')[0];
  assert.equal(pickModel(models, gemini), 'gemini-2.5-flash-lite');
  assert.equal(pickModel(models, gemini, 'gemini-1.5-pro'), 'gemini-1.5-pro');
  assert.deepEqual(selectableModels(['models/embedding-001', 'models/gemini-2.5-flash']), ['gemini-2.5-flash']);
});

/* -------------------------------------------------------------- dry check */

test('the dry check proves a Gemini key end to end', async () => {
  const key = 'AIzaSyD-1234567890abcdefghijklmnopqrs';
  const { fetcher, calls } = fakeFetch([
    { match: /generativelanguage\.googleapis\.com\/v1beta\/models$/, json: geminiModels },
    { match: /:generateContent$/, json: geminiReply('OK') },
  ]);

  const result = await checkKey({ key, fetcher });
  assert.equal(result.ok, true);
  assert.equal(result.providerId, 'gemini');
  // the account's own list decides: the newest id in the cheapest family, not a baked-in name
  assert.equal(result.model, 'gemini-3.5-flash-lite');
  assert.ok(result.models.includes('gemini-2.5-flash'));
  assert.ok(result.models.includes('gemini-3.6-flash'));
  assert.ok(result.steps.some((step) => step.ok && /key accepted/.test(step.label)));
  assert.equal(result.reply, 'OK');
  // the key is sent as a header, never in the URL
  assert.equal(calls[0].headers['x-goog-api-key'], key);
  assert.ok(!calls[0].url.includes(key));
});

test('an ambiguous sk- key is walked until a provider accepts it', async () => {
  const key = 'sk-abcdefghijklmnopqrst';
  const { fetcher, calls } = fakeFetch([
    // OpenAI rejects it...
    { match: /api\.openai\.com/, status: 401, json: { error: { message: 'Incorrect API key provided' } } },
    // ...DeepSeek takes it
    { match: /api\.deepseek\.com\/v1\/models/, json: { data: [{ id: 'deepseek-chat' }] } },
    { match: /api\.deepseek\.com\/v1\/chat\/completions/, json: { choices: [{ message: { content: 'OK' } }] } },
  ]);

  const result = await checkKey({ key, fetcher });
  assert.equal(result.ok, true);
  assert.equal(result.providerId, 'deepseek');
  assert.equal(result.tried[0].providerId, 'openai');
  assert.match(result.tried[0].error, /Incorrect API key/);
  assert.equal(calls.filter((call) => call.url.includes('openai')).length, 1, 'a rejected provider is not retried');
});

test('a dead key fails with something a person can act on', async () => {
  const { fetcher } = fakeFetch([{ match: /./, status: 401, json: { error: { message: 'API key not valid' } } }]);
  const result = await checkKey({ key: 'AIzaSyD-1234567890abcdefghijklmnopqrs', fetcher });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /API key not valid/);
  assert.match(result.hint ?? '', /rejected this key/);
  assert.equal(result.steps.every((step) => !step.ok || /no model list/.test(step.label)), true);
});

test('a pinned provider is not swapped for another one', async () => {
  const { fetcher, calls } = fakeFetch([
    { match: /api\.openai\.com\/v1\/models/, json: { data: [{ id: 'gpt-4o-mini' }] } },
    { match: /api\.openai\.com\/v1\/chat\/completions/, status: 429, json: { error: { message: 'rate limited' } } },
  ]);
  const result = await checkKey({ key: 'sk-abcdefghijklmnopqrst', providerId: 'openai', fetcher });
  assert.equal(result.ok, false);
  assert.match(result.hint ?? '', /rate limited|quota/);
  assert.ok(calls.every((call) => call.url.includes('openai')), 'no other provider was contacted');
});

/* ------------------------------------------------------------------ chat */

test('a provider that refuses the search field still answers without it', async () => {
  const key = 'xai-abcdefghijklmnopqrst';
  const { fetcher, calls } = fakeFetch([
    { match: /api\.x\.ai\/v1\/chat\/completions/, status: 400, json: { error: { message: 'search_parameters is not supported' } }, once: true },
    { match: /api\.x\.ai\/v1\/chat\/completions/, json: { choices: [{ message: { content: 'OK' } }] } },
  ]);

  const result = await chat(
    { spec: candidatesForKey(key)[0], baseUrl: candidatesForKey(key)[0].baseUrl, model: 'grok-3-mini' },
    key,
    { system: 'sys', user: 'user' },
    { fetcher, search: true }
  );
  assert.equal(result.ok, true);
  assert.equal(result.search, false, 'the retry dropped the search request');
  assert.equal(calls.length, 2);
  assert.match(calls[0].body, /search_parameters/);
  assert.ok(!/search_parameters/.test(calls[1].body));
});

test('an empty model list never looks like a working key', async () => {
  const { fetcher } = fakeFetch([{ match: /api\.groq\.com/, status: 200, json: { data: [] } }]);
  const spec = candidatesForKey('gsk_abcdefghijklmnopqrst')[0];
  const listed = await listModels({ spec, baseUrl: spec.baseUrl }, 'gsk_abcdefghijklmnopqrst', { fetcher });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.models, []);
});

test('a 400 that talks about the key is read as a key rejection', () => {
  // Google and xAI answer a bad key with 400, not 401 - the message is the only signal
  assert.match(errorHint(400, 'API key not valid. Please pass a valid API key.'), /rejected this key/);
  assert.match(errorHint(400, 'Incorrect API key provided'), /rejected this key/);
  assert.match(errorHint(403, 'Unauthorized'), /rejected this key/);
  // ... while a 400 about anything else keeps the request hint
  assert.match(errorHint(400, 'model gemini-9 does not exist'), /did not like the request/);
  assert.equal(errorHint(400, 'totally fine'), 'the provider did not like the request (usually a model name it does not serve)');
});

test('a key echoed back by a provider is masked before it reaches the screen', () => {
  const key = 'AIzaSyD-1234567890abcdefghijklmnopqrs';
  const masked = redact(`Incorrect API key provided: ${key}`, key);
  assert.ok(!masked.includes(key), 'the key survived redaction');
  assert.match(masked, /AIza••••rs/);
});

test('a public model list is not mistaken for a working key', async () => {
  // OpenRouter and NVIDIA serve /models to anyone, so the chat call is what decides
  const key = 'sk-or-v1-abcdefghijklmnop';
  const { fetcher, calls } = fakeFetch([
    { match: /openrouter\.ai\/api\/v1\/models/, json: { data: [{ id: 'google/gemini-2.5-flash:free' }] } },
    { match: /openrouter\.ai\/api\/v1\/chat\/completions/, status: 401, json: { error: { message: 'No auth credentials found' } } },
  ]);

  const result = await checkKey({ key, providerId: 'openrouter', fetcher });
  assert.equal(result.ok, false);
  assert.equal(result.steps.some((step) => step.label.includes('key accepted')), false, 'no step may claim the key was accepted');
  assert.ok(result.steps.some((step) => step.label.includes('model list') && step.ok));
  assert.match(result.hint ?? '', /rejected this key/);
  assert.equal(calls.length, 2);
});

test('provider errors are read out of every dialect', () => {
  assert.equal(errorMessage('{"error":{"message":"bad key"}}'), 'bad key');
  assert.equal(errorMessage('{"error":"bad key"}'), 'bad key');
  assert.equal(errorMessage('{"message":"bad key"}'), 'bad key');
  assert.equal(errorMessage('not json'), 'not json');
  assert.match(errorHint(401), /rejected this key/);
  assert.match(errorHint(429), /quota/);
  assert.equal(errorHint(200), '');
});

/* ------------------------------------------------------------- extraction */

test('numeric and date fields survive however the model printed them', () => {
  assert.equal(toNumber('₹1,250'), 1250);
  assert.equal(toNumber('+24'), 24);
  assert.equal(toNumber('2.41x'), 2.41);
  assert.equal(toNumber('N/A'), undefined);
  assert.equal(toNumber('TBA'), undefined);
  assert.equal(toNumber(59), 59);

  const now = new Date('2026-09-14T12:00:00Z');
  assert.equal(toIsoInstant('14 Sep 2026, 5:30 PM IST', now), '2026-09-14T12:00:00.000Z');
  assert.equal(toIsoInstant('2026-09-14T17:30:00+05:30', now), '2026-09-14T12:00:00.000Z');
  assert.equal(toIsoInstant('14 Sep 2050, 5:30 PM IST', now), undefined, 'the sentinel year is never believed');
  assert.equal(toIsoInstant('14 Sep 2028, 5:30 PM IST', now), undefined, 'a stamp years ahead is not a quote');
});

test('a row with an impossible figure is dropped, not shown', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const good = coerceRow({ name: 'Veegaland Developers', gmp: '₹22', subscriptionTotal: '2.41x', asOf: '2026-09-14T17:30:00+05:30' }, now);
  assert.equal(good.row?.gmp, 22);
  assert.equal(good.row?.subscriptionTotal, 2.41);
  assert.equal(good.row?.asOf, '2026-09-14T12:00:00.000Z');

  assert.match(coerceRow({ gmp: 12 }, now).reason ?? '', /no name/);
  assert.match(coerceRow({ name: 'X', gmp: 900000 }, now).reason ?? '', /no figure/);
  assert.match(coerceRow({ name: 'X', priceBandLow: 150, priceBandHigh: 140, gmp: 5 }, now).row ? '' : 'band', /band|^$/);
  const banded = coerceRow({ name: 'X', priceBandLow: 150, priceBandHigh: 140, gmp: 5 }, now).row!;
  assert.equal(banded.bandHigh, undefined, 'an inverted band is not published as a band');
});

test('the reply parser copes with prose, fences and trailing commas', () => {
  const fenced = 'Here you go:\n```json\n[{"name":"Hero Motors","gmp":24,"subscriptionTotal":"2.35x"},]\n```\nHope that helps!';
  const rows = extractRows(fenced, { now: new Date('2026-09-14T12:00:00Z') });
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].name, 'Hero Motors');
  assert.equal(rows.rows[0].gmp, 24);

  const junk = extractRows('[{"name":"A","gmp":12},{"nope":true},{"name":"B","closeDate":"2050-01-01"},{"name":"C"}]');
  assert.equal(junk.rows.length, 1);
  assert.equal(junk.rejected, 3);
  assert.ok(junk.reasons.length > 0);

  assert.equal(extractJsonArray('no json at all'), null);
  assert.deepEqual(extractJsonArray('{"rows":[{"name":"A","gmp":1}]}')?.length, 1, 'an object wrapper is unwrapped');
});

test('a model that ignores the JSON instruction can still be read', () => {
  const rows = extractRows('- Hero Motors: GMP +24, subscription 2.35x, closes 15 Sep 2026');
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].name, 'Hero Motors');
  assert.equal(rows.rows[0].gmp, 24);
  assert.equal(rows.rows[0].subscriptionTotal, 2.35);
});

test('the prompt asks only about issues whose figures can still move', () => {
  const now = new Date('2026-09-14T00:00:00+05:30');
  const picks = picksForSearch(IPOT, now, 5);
  assert.equal(picks.length, 5);
  const prompt = boardPrompt(picks, { now, limit: 5 });
  assert.match(prompt.user, /bidding \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
  assert.match(prompt.user, /Today is 2026-09-13/);
  assert.match(prompt.system, /JSON array only|raw JSON only/);
  assert.ok(picks.every((ipo) => !/\b2050\b/.test(ipo.closeDate)));
});

/* ------------------------------------------------------------- full search */

const aiRow = (over: Record<string, unknown> = {}) => ({
  name: 'Veegaland Developers',
  gmp: 22,
  gmpUpdated: '2026-09-14T17:30:00+05:30',
  subscriptionTotal: 2.41,
  asOf: '2026-09-14T17:31:00+05:30',
  sourceUrl: 'https://example.com/veegaland',
  ...over,
});

test('a search returns believable rows and its own timestamp', async () => {
  const key = 'AIzaSyD-1234567890abcdefghijklmnopqrs';
  const { fetcher } = fakeFetch([
    { match: /:generateContent$/, json: geminiReply(JSON.stringify([aiRow()])) },
  ]);

  const result = await aiBoardSearch(IPOT, { key, providerId: 'gemini', fetcher, now: new Date('2026-09-14T12:05:00Z') });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.asOf, '2026-09-14T12:01:00.000Z');
  assert.equal(aiSourceStatus(result).key, 'ai');
  assert.match(aiSourceStatus(result).note ?? '', /Google Gemini/);
});

test('a search that cannot be verified fails rather than inventing rows', async () => {
  const key = 'AIzaSyD-1234567890abcdefghijklmnopqrs';
  const { fetcher } = fakeFetch([
    { match: /:generateContent$/, json: geminiReply('I could not find any current figures, sorry.') },
  ]);
  const failed = await aiBoardSearch(IPOT, { key, providerId: 'gemini', fetcher });
  assert.equal(failed.ok, false);
  assert.equal(failed.rows.length, 0);
  assert.match(failed.error ?? '', /usable figures/);

  const offline = await aiBoardSearch(IPOT, {
    key,
    providerId: 'gemini',
    fetcher: (async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch,
  });
  assert.equal(offline.ok, false);
  assert.match(offline.error ?? '', /Network request failed/);
});

test('a rotted default model is replaced by one the key can reach', async () => {
  const key = 'AIzaSyD-1234567890abcdefghijklmnopqrs';
  const { fetcher, calls } = fakeFetch([
    // the provider's default model id is gone by the time the user pastes their key
    { match: /models\/gemini-2\.5-flash:generateContent$/, status: 404, json: { error: { message: 'model not found' } }, once: true },
    { match: /v1beta\/models$/, json: geminiModels },
    { match: /:generateContent$/, json: geminiReply(JSON.stringify([aiRow()])) },
  ]);

  const result = await aiBoardSearch(IPOT, { key, providerId: 'gemini', fetcher });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.model, 'gemini-3.5-flash-lite', 'the stale default was never even tried');
  assert.equal(calls.length, 2, 'the model list, then one chat request');
});

test('a provider that cannot search is never asked to guess live figures', async () => {
  // the key the user actually has: Groq, whose llama models have no web access
  const key = 'gsk_abcdefghijklmnopqrst';
  const { fetcher, calls } = fakeFetch([
    { match: /api\.groq\.com\/openai\/v1\/models/, json: { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-20b' }] } },
    { match: /chat\/completions$/, json: { choices: [{ message: { content: JSON.stringify([aiRow()]) } }] } },
  ]);

  const result = await aiBoardSearch(IPOT, { key, providerId: 'groq', fetcher });
  assert.equal(result.ok, false);
  assert.equal(result.rows.length, 0, 'rows invented from training data must not be usable');
  assert.match(result.error ?? '', /cannot search the web/);
  assert.match(result.hint ?? '', /Gemini|Perplexity|OpenRouter/);
  assert.equal(calls.length, 1, 'only the model list was called - no chat request');
});

test('a provider whose own model searches is used through that model', async () => {
  const key = 'gsk_abcdefghijklmnopqrst';
  const { fetcher, calls } = fakeFetch([
    {
      match: /api\.groq\.com\/openai\/v1\/models/,
      json: { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'groq/compound-mini' }, { id: 'groq/compound' }] },
    },
    { match: /chat\/completions$/, json: { choices: [{ message: { content: JSON.stringify([aiRow()]) } }] } },
  ]);

  const result = await aiBoardSearch(IPOT, { key, providerId: 'groq', fetcher, now: new Date('2026-09-14T12:05:00Z') });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'groq/compound', 'the search-capable model was not chosen');
  assert.equal(result.rows.length, 1);
  assert.equal(result.search, true, 'a searching model must be reported as a web search');
  assert.match(result.hint ?? '', /searches for itself/);
  assert.equal(calls.length, 2, 'model list, then one chat request');
});

/* ------------------------------------------------------------------ merge */

test('AI rows fill gaps but never outrank a published board', () => {
  const bundled: IPO = {
    ...IPOT[0],
    id: 'ai-subject',
    name: 'Ai Subject Ltd',
    gmp: 10,
    gmpUpdated: undefined,
    subscription: undefined,
    aiFilled: undefined,
    priceBandLow: 100,
    priceBandHigh: 110,
  };
  const board = [bundled, IPOT[1]];

  const aiOnly = mergeAiResult(
    board,
    { rows: [{ name: 'Ai Subject Ltd', gmp: 33, subscriptionTotal: 4.5, asOf: '2026-09-14T12:00:00.000Z' }], asOf: '2026-09-14T12:00:00.000Z' },
    { fetchedAt: Date.now(), sources: [] }
  );
  const filled = aiOnly.ipos[0];
  assert.equal(filled.gmp, 33);
  assert.equal(filled.subscription?.total, 4.5);
  assert.equal(filled.aiFilled, true, 'the figure is labelled as AI-filled');
  assert.equal(aiOnly.aiApplied, 1);
  assert.equal(aiOnly.added, 0, 'a model reply can never add an issue to the board');
  assert.equal(aiOnly.ipos.length, board.length);

  // now the same issue arrives from a published board: the board wins and the label goes away
  const published = emptyParsedLive();
  published.gmp = {
    rows: [
      {
        id: 'ai-subject',
        name: 'Ai Subject Ltd',
        segment: 'Mainboard',
        gmp: 12,
        updatedAt: '2026-09-14T12:30:00.000Z',
      },
    ],
    quoted: 1,
    tracked: 1,
    asOf: '2026-09-14T12:30:00.000Z',
  };
  published.ai = { rows: [{ name: 'Ai Subject Ltd', gmp: 33 }] };
  const merged = mergeAiResult(board, { rows: published.ai.rows }, { fetchedAt: Date.now(), sources: [] });
  assert.equal(merged.ipos[0].gmp, 33);
  const withPublished = mergeAiResult(merged.ipos, { rows: [] }, { fetchedAt: Date.now(), sources: [] });
  assert.equal(withPublished.ipos[0].gmp, 33, 'no published row in this stub, so the AI figure stays');
  assert.equal(withPublished.ipos[0].aiFilled, true);
});

test('an unmatched model row is ignored instead of guessed onto an issue', () => {
  const board = mergeAiResult(IPOT, { rows: [{ name: 'Completely Unknown Issue', gmp: 99 }] }, { fetchedAt: Date.now(), sources: [] });
  assert.equal(board.added, 0);
  assert.equal(board.aiApplied, 0);
  assert.equal(board.ipos.length, IPOT.length);
});

test('a source status names the provider and model that answered', () => {
  const idle = aiIdleStatus('Google Gemini • gemini-2.5-flash armed - used only when the boards fail');
  assert.equal(idle.key, 'ai');
  assert.equal(idle.ok, true);
  assert.match(idle.note ?? '', /gemini-2\.5-flash/);
});

/* ----------------------------------------------------------- web proxy rule */

test('the web proxy only forwards to known provider hosts', async () => {
  const require = createRequire(import.meta.url);
  const proxy = require('../../../api/ai.js') as (req: unknown, res: unknown) => Promise<void>;

  const call = async (url: string) => {
    const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
    const res = {
      status(code: number) {
        sent.status = code;
        return this;
      },
      json(payload: unknown) {
        sent.body = payload;
        return this;
      },
      setHeader(name: string, value: string) {
        sent.headers[name] = value;
      },
      send(payload: unknown) {
        sent.body = payload;
        return this;
      },
    };
    await proxy({ method: 'POST', body: { url, method: 'GET', headers: { Authorization: 'Bearer secret' } } }, res);
    return sent;
  };

  const blocked = await call('https://evil.example.com/v1/models');
  assert.equal(blocked.status, 403);

  const originalFetch = globalThis.fetch;
  let forwarded: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    forwarded = { url: String(url), init };
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"data":[]}' } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    const allowed = await call('https://api.openai.com/v1/models');
    assert.equal(allowed.status, 200);
    assert.equal(forwarded.url, 'https://api.openai.com/v1/models');
    assert.equal((forwarded.init?.headers as Record<string, string>).Authorization, 'Bearer secret');
    assert.equal(allowed.headers['Cache-Control'], 'no-store');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ------------------------------------------------- model rot (the 2.5 -> 3.x switches) */

test('model ids rank by family, then by the newest version in that family', () => {
  assert.equal(modelVersion('models/gemini-3.6-flash'), 3.06);
  assert.equal(modelVersion('gpt-5.1-mini'), 5.01);
  assert.equal(modelVersion('llama-3.3-70b-versatile'), 3.03, 'the 70b is a parameter count');
  assert.equal(modelVersion('openai/gpt-oss-20b'), 0, '20b is not a version');
  assert.ok(modelVersion('gemini-3.6-flash') > modelVersion('gemini-2.5-flash'));

  const gemini = providerSpec('gemini');
  const ranked = rankModels(
    ['models/gemini-2.5-flash', 'models/gemini-3.6-flash', 'models/gemini-3.5-flash-lite', 'models/embedding-001'],
    gemini
  );
  assert.equal(ranked[0], 'gemini-3.5-flash-lite', 'the cheapest family is tried first, newest in it');
  assert.ok(ranked.indexOf('gemini-3.6-flash') < ranked.indexOf('gemini-2.5-flash'));
  assert.ok(!ranked.includes('embedding-001'), 'an embedding model must never be a candidate');

  // an explicit choice is still respected
  assert.equal(pickModel(['gemini-2.5-flash', 'gemini-3.6-flash'], gemini, 'gemini-3.6-flash'), 'gemini-3.6-flash');
});

test('a retired model name costs one attempt, and the newest listed model answers', async () => {
  // the exact failure from the phone: 2.5 is retired, 2.5-lite too, "latest" is overloaded,
  // and the account's own list already carries 3.5 / 3.6
  const key = 'AIzaSyD-1234567890abcdefghijklmnopqrs';
  const { fetcher, calls } = fakeFetch([
    { match: /v1beta\/models$/, json: geminiModels },
    { match: /gemini-2\.5-flash-lite:generateContent/, status: 404, json: RETIRED('gemini-2.5-flash-lite', 'gemini-3.5-flash-lite') },
    { match: /gemini-2\.5-flash:generateContent/, status: 404, json: RETIRED('gemini-2.5-flash', 'gemini-3.6-flash') },
    { match: /gemini-flash-latest:generateContent/, status: 503, json: { error: { message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } } },
    { match: /:generateContent$/, json: geminiReply('OK') },
  ]);

  const result = await checkKey({ key, providerId: 'gemini', fetcher });
  assert.equal(result.ok, true, `the check failed: ${result.error ?? ''}`);
  assert.equal(result.model, 'gemini-3.5-flash-lite', 'the newest model of the cheapest family answered');
  assert.ok(
    calls.length <= 1 + MODEL_ATTEMPT_LIMIT,
    `the check made ${calls.length} calls - it must not walk the whole model list`
  );
  assert.ok(result.steps.some((step) => step.label.includes('key accepted')));
});

test('when every model is busy the key is not blamed', async () => {
  const key = 'AIzaSyD-1234567890abcdefghijklmnopqrs';
  const { fetcher, calls } = fakeFetch([
    { match: /v1beta\/models$/, json: geminiModels },
    { match: /:generateContent$/, status: 503, json: { error: { message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } } },
  ]);

  const result = await checkKey({ key, providerId: 'gemini', fetcher });
  assert.equal(result.ok, false);
  assert.match(result.hint ?? '', /not rejected/, 'a 503 must not read as a bad key');
  // it still tries several models before giving up on the provider
  assert.ok(calls.length >= 3, `only ${calls.length} attempts were made`);
});

test('a retired model name does not stop the live search either', async () => {
  const key = 'AIzaSyD-1234567890abcdefghijklmnopqrs';
  const { fetcher } = fakeFetch([
    { match: /v1beta\/models$/, json: geminiModels },
    { match: /gemini-2\.5-flash-lite:generateContent/, status: 404, json: RETIRED('gemini-2.5-flash-lite', 'gemini-3.5-flash-lite') },
    { match: /gemini-3\.5-flash-lite:generateContent/, json: geminiReply(JSON.stringify([aiRow()])) },
  ]);

  const result = await aiBoardSearch(IPOT, {
    key,
    providerId: 'gemini',
    // the model remembered from an earlier session, now retired
    model: 'gemini-2.5-flash-lite',
    fetcher,
  });
  assert.equal(result.ok, true, `the search failed: ${result.error ?? ''}`);
  assert.equal(result.model, 'gemini-3.5-flash-lite');
  assert.equal(result.rows.length, 1);
});
