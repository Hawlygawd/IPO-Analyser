/**
 * The HTTP half of the AI assist: list models, send one prompt, and report - in plain
 * words - whether a key works.
 *
 * Everything is injectable (`fetcher`, timeouts) so the tests can drive a fake provider,
 * and nothing here imports react-native: the CI script that hits the real endpoints uses
 * this same code.
 */

import {
  AI_PROVIDERS,
  MODEL_ATTEMPT_LIMIT,
  candidatesForKey,
  providerSpec,
  rankModels,
  selectableModels,
  type AiProviderId,
  type AiProviderSpec,
} from './providers';

export interface AiHttpOptions {
  fetcher?: typeof fetch;
  /**
   * Web builds go through `/api/ai` on the same origin: browsers are blocked by CORS on
   * several provider APIs, and an OpenAI/Anthropic key must not have to break there.
   */
  useProxy?: boolean;
  /** Timeout for the (cheap) model list call. */
  listTimeoutMs?: number;
  /** Timeout for a generating call - models can think for a while. */
  chatTimeoutMs?: number;
}

export interface AiTarget {
  spec: AiProviderSpec;
  baseUrl: string;
  model?: string;
}

export interface HttpAttempt {
  ok: boolean;
  status: number;
  text: string;
  ms: number;
  error?: string;
}

export interface KeyCheckStep {
  label: string;
  ok: boolean;
  detail: string;
  ms?: number;
}

export interface KeyCheckTries {
  providerId: AiProviderId;
  label: string;
  error: string;
}

export interface KeyCheckResult {
  ok: boolean;
  /** provider that answered (on success) or the one the key was tested as */
  providerId: AiProviderId;
  providerLabel: string;
  model: string;
  models: string[];
  steps: KeyCheckStep[];
  latencyMs: number;
  /** the model's own reply to the tiny test prompt */
  reply?: string;
  error?: string;
  hint?: string;
  tried: KeyCheckTries[];
}

export interface ChatResult {
  ok: boolean;
  text: string;
  status: number;
  model: string;
  search: boolean;
  ms: number;
  error?: string;
  hint?: string;
  /** what the provider actually said, for the diagnostics panel */
  raw?: string;
}

/* ------------------------------------------------------------------ plumbing */

function withTimeout(ms: number): { signal: AbortSignal | undefined; done: () => void; timedOut: () => boolean } {
  if (typeof AbortController === 'undefined') return { signal: undefined, done: () => undefined, timedOut: () => false };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  return { signal: controller.signal, done: () => clearTimeout(timer), timedOut: () => timedOut };
}

/** Reads a provider error body without ever echoing the key back. */
export function errorMessage(body: string): string {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed.error as Record<string, unknown> | string | undefined;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
    for (const field of ['message', 'detail', 'error_description', 'title']) {
      const value = parsed[field];
      if (typeof value === 'string' && value) return value;
    }
    return '';
  } catch {
    return body.slice(0, 300);
  }
}

/**
 * Turns a status code (and, when we have it, the provider's own words) into something a
 * phone user can act on.
 *
 * The status alone is not enough: Google and xAI answer a bad key with HTTP 400 and a
 * message, while OpenRouter and NVIDIA serve their model list to anyone and only fail
 * later - so the message is what tells the two cases apart.
 */
export function errorHint(status: number, message = ''): string {
  const keyish = /api[ _-]?key|invalid.{0,20}key|key.{0,20}invalid|unauthor|authentication|credential|forbidden|permission/i.test(
    message
  );
  if (status === 401 || status === 403 || ((status === 400 || status === 402) && keyish)) {
    return 'the provider rejected this key - check it was copied whole, and that the key is active';
  }
  if (
    status === 404 ||
    /no longer available|decommission|unsupported model|not available to new users/i.test(message)
  ) {
    return 'the provider retired that model name - the app now picks the newest one your key can reach';
  }
  if (status === 429) return 'this key is rate limited or its free quota is used up for now';
  if (status === 402) return 'the provider wants billing enabled on this key';
  if (status === 400) return 'the provider did not like the request (usually a model name it does not serve)';
  if (status >= 500) return 'the provider had a server error - try again in a minute';
  return '';
}

/** Never let a provider echo the user's key back into the UI: mask it on the way in. */
export function redact(text: string, key: string): string {
  if (!text || !key || key.length < 8) return text;
  return text.split(key).join(`${key.slice(0, 4)}••••${key.slice(-2)}`);
}

interface RequestShape {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
}

/** One call, either direct or through the same-origin proxy on the web build. */
async function callJson(
  shape: RequestShape,
  timeoutMs: number,
  http: AiHttpOptions
): Promise<HttpAttempt> {
  const fetcher = http.fetcher ?? fetch;
  const started = Date.now();
  const { signal, done, timedOut } = withTimeout(timeoutMs);
  const headers: Record<string, string> = { Accept: 'application/json', ...shape.headers };
  const payload = shape.body === undefined ? undefined : JSON.stringify(shape.body);
  if (payload) headers['Content-Type'] = 'application/json';

  const target = http.useProxy ? '/api/ai' : shape.url;
  const body = http.useProxy
    ? JSON.stringify({ url: shape.url, method: shape.method, headers, body: payload })
    : payload;

  try {
    const response = await fetcher(target, { method: http.useProxy ? 'POST' : shape.method, headers, body, signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, ms: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const friendly = timedOut() ? 'timed out' : /abort/i.test(message) ? 'timed out' : message;
    return { ok: false, status: 0, text: '', ms: Date.now() - started, error: friendly };
  } finally {
    done();
  }
}

function authHeaders(spec: AiProviderSpec, key: string): Record<string, string> {
  const headers: Record<string, string> = { ...(spec.extraHeaders ?? {}) };
  if (spec.auth === 'bearer') headers.Authorization = `Bearer ${key}`;
  if (spec.auth === 'optional-bearer' && key) headers.Authorization = `Bearer ${key}`;
  if (spec.auth === 'gemini-key-header') headers['x-goog-api-key'] = key;
  if (spec.auth === 'anthropic-header') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    // allows a browser (the web build) to talk to Anthropic directly when there is no proxy
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  return headers;
}

function targetFor(spec: AiProviderSpec, baseUrl?: string | null, model?: string | null): AiTarget {
  return {
    spec,
    baseUrl: (baseUrl ?? '').trim() || spec.baseUrl,
    model: (model ?? '').trim() || undefined,
  };
}

/* --------------------------------------------------------------- model lists */

/** Model ids the key can reach. Fails closed: a bad key returns an empty list. */
export async function listModels(
  target: AiTarget,
  key: string,
  http: AiHttpOptions = {}
): Promise<{ ok: boolean; models: string[]; status: number; error?: string; ms: number }> {
  const { spec, baseUrl } = target;
  const started = Date.now();
  if (!spec.listsModels) return { ok: true, models: [], status: 0, ms: 0 };
  const attempt = await callJson(
    { url: `${baseUrl}/models`, method: 'GET', headers: authHeaders(spec, key) },
    http.listTimeoutMs ?? 20000,
    http
  );
  if (!attempt.ok) {
    const detail = redact(attempt.error ?? errorMessage(attempt.text) ?? 'the provider refused the request', key);
    return {
      ok: false,
      models: [],
      status: attempt.status,
      // the status goes into the message so the hint below (and the UI) can explain it
      error: `${detail}${attempt.status ? ` (HTTP ${attempt.status})` : ''}`,
      ms: Date.now() - started,
    };
  }
  let models: string[] = [];
  try {
    const parsed = JSON.parse(attempt.text) as Record<string, unknown>;
    const data = (parsed.data ?? parsed.models ?? []) as unknown[];
    models = data
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        const record = entry as Record<string, unknown>;
        // gemini: {name: "models/gemini-2.5-flash", supportedGenerationMethods: [...]}
        const id = (record.id ?? record.name ?? record.model) as string | undefined;
        const methods = record.supportedGenerationMethods as string[] | undefined;
        if (methods && !methods.includes('generateContent')) return '';
        return id ?? '';
      })
      .filter(Boolean);
  } catch {
    return { ok: false, models: [], status: attempt.status, error: 'the model list was not valid JSON', ms: Date.now() - started };
  }
  return { ok: true, models, status: attempt.status, ms: Date.now() - started };
}

/* ------------------------------------------------------------------ chat call */

function chatShape(target: AiTarget, key: string, prompt: { system: string; user: string }, search: boolean): RequestShape {
  const { spec, baseUrl, model } = target;
  const headers = authHeaders(spec, key);
  const modelId = model ?? spec.modelFallback;
  const useSearch = search && spec.search !== 'none';
  // OpenRouter asks for search with a model suffix rather than a request field
  const requested = useSearch && spec.search === 'online-suffix' && !modelId.endsWith(':online') ? `${modelId}:online` : modelId;

  if (spec.api === 'gemini') {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    };
    if (useSearch && spec.search === 'google-grounding') body.tools = [{ google_search: {} }];
    return { url: `${baseUrl}/models/${requested}:generateContent`, method: 'POST', headers, body };
  }

  if (spec.api === 'anthropic') {
    const body: Record<string, unknown> = {
      model: requested,
      max_tokens: 2048,
      temperature: 0.1,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    };
    if (useSearch && spec.search === 'anthropic-tool') {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    }
    return { url: `${baseUrl}/messages`, method: 'POST', headers, body };
  }

  const body: Record<string, unknown> = {
    model: requested,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  };
  if (spec.tokenCap === 'max_tokens') body.max_tokens = 2048;
  if (spec.tokenCap === 'max_completion_tokens') body.max_completion_tokens = 2048;
  if (useSearch && spec.search === 'x-live-search') body.search_parameters = { mode: 'auto', return_citations: true };
  return { url: `${baseUrl}/chat/completions`, method: 'POST', headers, body };
}

/** The assistant's text out of whichever dialect answered, or a reason it was empty. */
function readChat(spec: AiProviderSpec, text: string): { text: string; problem?: string } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text: '', problem: 'the provider sent a non-JSON reply' };
  }
  if (spec.api === 'gemini') {
    const candidates = (parsed.candidates ?? []) as Record<string, unknown>[];
    const parts = ((candidates[0]?.content as Record<string, unknown> | undefined)?.parts ?? []) as Record<string, unknown>[];
    const out = parts.map((part) => (typeof part.text === 'string' ? part.text : '')).join('').trim();
    if (out) return { text: out };
    const blocked = (parsed.promptFeedback as Record<string, unknown> | undefined)?.blockReason;
    const finish = candidates[0]?.finishReason;
    return { text: '', problem: blocked ? `the model blocked the prompt (${String(blocked)})` : finish === 'MAX_TOKENS' ? 'the model ran out of output budget' : 'the model returned no text' };
  }
  if (spec.api === 'anthropic') {
    const blocks = (parsed.content ?? []) as Record<string, unknown>[];
    const out = blocks.map((block) => (typeof block.text === 'string' ? block.text : '')).join('').trim();
    return out ? { text: out } : { text: '', problem: 'the model returned no text' };
  }
  const choices = (parsed.choices ?? []) as Record<string, unknown>[];
  const message = choices[0]?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === 'string' && content.trim()) return { text: content.trim() };
  // some endpoints (reasoning models) put the text in an array of blocks
  if (Array.isArray(content)) {
    const out = (content as Record<string, unknown>[])
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('')
      .trim();
    if (out) return { text: out };
  }
  const finish = choices[0]?.finish_reason;
  return { text: '', problem: finish ? `the model stopped early (${String(finish)})` : 'the model returned no text' };
}

export async function chat(
  target: AiTarget,
  key: string,
  prompt: { system: string; user: string },
  http: AiHttpOptions & { search?: boolean } = {}
): Promise<ChatResult> {
  const { spec } = target;
  const search = Boolean(http.search && spec.search !== 'none');
  const modelId = target.model ?? spec.modelFallback;
  const timeout = http.chatTimeoutMs ?? 90000;

  let attempt = await callJson(chatShape(target, key, prompt, search), timeout, http);
  let effectiveSearch = search;

  // A provider that does not accept the search field (or the :online suffix) still answers
  // without it - a stale answer beats no answer, so retry once and say so.
  if (!attempt.ok && search && attempt.status === 400) {
    attempt = await callJson(chatShape(target, key, prompt, false), timeout, http);
    effectiveSearch = false;
  }

  if (!attempt.ok) {
    const detail = redact(attempt.error ?? errorMessage(attempt.text) ?? 'the provider refused the request', key);
    return {
      ok: false,
      text: '',
      status: attempt.status,
      model: modelId,
      search: effectiveSearch,
      ms: attempt.ms,
      error: `${detail}${attempt.status ? ` (HTTP ${attempt.status})` : ''}`,
      hint: errorHint(attempt.status, detail),
      raw: redact(attempt.text.slice(0, 600), key),
    };
  }

  const read = readChat(spec, attempt.text);
  if (!read.text) {
    return {
      ok: false,
      text: '',
      status: attempt.status,
      model: modelId,
      search: effectiveSearch,
      ms: attempt.ms,
      error: read.problem ?? 'the model returned no text',
      raw: attempt.text.slice(0, 600),
    };
  }
  return {
    ok: true,
    text: read.text,
    status: attempt.status,
    model: modelId,
    search: effectiveSearch,
    ms: attempt.ms,
    raw: attempt.text.slice(0, 600),
  };
}

/* ------------------------------------------------------------------ dry check */

const PING = {
  system: 'You are a connectivity check. Answer with one word.',
  user: 'Reply with exactly: OK',
};

export interface KeyCheckOptions extends AiHttpOptions {
  key: string;
  /** Pin a provider; omit to let the key shape decide (and try the others too). */
  providerId?: AiProviderId | null;
  baseUrl?: string | null;
  model?: string | null;
  /** How many providers to try when the key shape is ambiguous. */
  maxCandidates?: number;
  /** How many models to try on one provider before giving up on it (default 6). */
  maxModelAttempts?: number;
  /** Wall-clock cap for the whole check (default 90s), so six slow timeouts cannot hang it. */
  checkBudgetMs?: number;
}

/**
 * The dry check behind the "Test this key" button: does the key authenticate, which models
 * can it reach, does one of them actually answer - all without touching the board.
 */
export async function checkKey(options: KeyCheckOptions): Promise<KeyCheckResult> {
  const key = options.key.trim();
  const started = Date.now();
  const pinned = Boolean(options.providerId);
  const specs = pinned
    ? [providerSpec(options.providerId)]
    : candidatesForKey(key);
  const queue = specs.slice(0, Math.max(1, options.maxCandidates ?? 3));
  const steps: KeyCheckStep[] = [];
  const tried: KeyCheckTries[] = [];

  const fail = (
    spec: AiProviderSpec,
    model: string,
    error: string,
    hint: string,
    models: string[] = []
  ): KeyCheckResult => ({
    ok: false,
    providerId: spec.id,
    providerLabel: spec.label,
    model,
    models,
    steps,
    latencyMs: Date.now() - started,
    error,
    hint,
    tried,
  });

  for (const spec of queue) {
    const target = targetFor(spec, options.baseUrl, options.model);

    const listed = await listModels(target, key, options);
    let models = selectableModels(listed.models);
    if (spec.listsModels) {
      if (!listed.ok) {
        const error = redact(listed.error ?? `HTTP ${listed.status}`, key);
        tried.push({ providerId: spec.id, label: spec.label, error });
        steps.push({
          label: `${spec.label}: model list`,
          ok: false,
          detail: `${error}${errorHint(listed.status, error) ? ` - ${errorHint(listed.status, error)}` : ''}`,
          ms: listed.ms,
        });
        if (pinned) {
          return fail(spec, target.model ?? spec.modelFallback, error, errorHint(listed.status, error));
        }
        continue;
      }
      steps.push({
        label: `${spec.label}: model list`,
        ok: true,
        detail: `${models.length} model${models.length === 1 ? '' : 's'} listed${spec.listsModels ? ' (some providers list models without checking the key)' : ''}`,
        ms: listed.ms,
      });
    } else {
      steps.push({ label: `${spec.label}: no model list`, ok: true, detail: 'this provider has no list endpoint - going straight to a test call' });
    }

    /**
     * The candidates, best first. Model names move faster than any release we could ship:
     * Google answered a 2.5 request with "no longer available to new users - use
     * models/gemini-3.6-flash" while handing us a list of 30 models that contained it. So the
     * order is user's pick, then the newest of the best family, then the rest newest-first -
     * and a retired name costs one attempt, not the whole check.
     */
    const candidates = rankModels(models, spec, target.model);
    const attemptLimit = Math.max(
      1,
      Math.min(options.maxModelAttempts ?? MODEL_ATTEMPT_LIMIT, candidates.length || 1)
    );

    const deadline = started + (options.checkBudgetMs ?? 90000);
    let lastError = '';
    let lastHint = '';
    let lastStatus = 0;
    let answered = false;
    for (const model of candidates.slice(0, attemptLimit)) {
      if (Date.now() > deadline) {
        lastHint = 'the provider was too slow to answer within a minute and a half - try again on a better connection';
        break;
      }
      const reply = await chat({ spec, baseUrl: target.baseUrl, model }, key, PING, {
        ...options,
        chatTimeoutMs: options.chatTimeoutMs ?? 45000,
      });
      if (reply.ok) {
        steps.push({ label: `${spec.label}: ${model}`, ok: true, detail: `answered in ${(reply.ms / 1000).toFixed(1)}s`, ms: reply.ms });
        steps.push({
          label: `${spec.label}: key accepted`,
          ok: true,
          detail: 'the provider answered a real request with this key',
        });
        return {
          ok: true,
          providerId: spec.id,
          providerLabel: spec.label,
          model,
          models,
          steps,
          latencyMs: Date.now() - started,
          reply: reply.text.slice(0, 120),
          tried,
        };
      }
      lastError = reply.error ?? 'the model did not answer';
      lastHint = reply.hint ?? '';
      lastStatus = reply.status;
      steps.push({ label: `${spec.label}: ${model}`, ok: false, detail: lastError, ms: reply.ms });
      if (reply.status === 401 || reply.status === 403) break; // the key is wrong for this provider
    }

    // Every model refused for a reason that has nothing to do with the key (the provider was
    // overloaded, or it retired the names we knew). Say that, instead of "key failed".
    if (!answered && lastStatus >= 500) {
      lastHint =
        'your key was not rejected - the provider is overloaded or retired the models the app tried; tap Test again in a minute';
    } else if (!answered && lastStatus === 429) {
      lastHint = 'your key was not rejected - this key is rate limited or out of free quota for now';
    }

    tried.push({ providerId: spec.id, label: spec.label, error: redact(lastError, key) || 'no model answered' });
    if (pinned) return fail(spec, candidates[0] ?? spec.modelFallback, lastError, lastHint, models);
    if (answered) break;
  }

  const last = tried[tried.length - 1];
  const error = last?.error ?? 'no provider accepted this key';
  const status = /HTTP (\d+)/.exec(error)?.[1];
  return {
    ok: false,
    providerId: last?.providerId ?? 'custom',
    providerLabel: last?.label ?? 'Unrecognised',
    model: '',
    models: [],
    steps,
    latencyMs: Date.now() - started,
    error,
    hint: errorHint(status ? Number(status) : 0),
    tried,
  };
}

/** Providers worth showing in the Settings picker (the registry, with ids). */
export const PROVIDER_CHOICES = AI_PROVIDERS;
