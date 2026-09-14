/**
 * The AI half of the live path: ask a model (with web search where the provider has it) for
 * the current grey market premium and subscription figures, then hand the rows to the same
 * merge the parsed pages go through.
 *
 * Two rules keep this honest:
 *  - published board data always wins over anything a model says (merge.ts enforces it);
 *  - a failed search returns a reason, never a guess - the caller decides whether to show
 *    the cached snapshot instead.
 *
 * No react-native import here: scripts/ai-key-report.ts runs this in plain node.
 */

import type { IPO } from '../types';
import { SOURCE_LABELS, type LiveSourceStatus } from '../live/merge';
import type { LiveAiRow } from '../live/parse';
import { boardPrompt, extractRows, picksForSearch } from './extract';
import { chat, listModels, type AiHttpOptions } from './client';
import { candidatesForKey, pickModel, providerSpec, type AiProviderId, type AiProviderSpec } from './providers';

export interface AiSearchOptions extends AiHttpOptions {
  key: string;
  /** pin the provider (the normal case once a key has been tested) */
  providerId?: AiProviderId | null;
  model?: string | null;
  baseUrl?: string | null;
  /** let the provider search the live web; off means the model answers from its training */
  search?: boolean;
  /** how many issues to ask about */
  limit?: number;
  now?: Date;
}

export interface AiSearchResult {
  ok: boolean;
  rows: LiveAiRow[];
  /** rows the model returned that could not be believed */
  rejected: number;
  reasons: string[];
  providerId: AiProviderId;
  providerLabel: string;
  model: string;
  search: boolean;
  /** newest timestamp the model reported for these figures */
  asOf?: string;
  latencyMs: number;
  error?: string;
  hint?: string;
  /** the model's own reply, truncated - shown behind "what did it say?" in Settings */
  raw?: string;
}

function baseResult(spec: AiProviderSpec, model: string, search: boolean, started: number): AiSearchResult {
  return {
    ok: false,
    rows: [],
    rejected: 0,
    reasons: [],
    providerId: spec.id,
    providerLabel: spec.label,
    model,
    search,
    latencyMs: Date.now() - started,
  };
}

/** Newest timestamp across the rows: what the chip and the "as of" rows will show. */
function newestStamp(rows: LiveAiRow[]): string | undefined {
  const stamps = rows
    .flatMap((row) => [row.asOf, row.gmpUpdated])
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (stamps.length === 0) return undefined;
  return new Date(Math.max(...stamps)).toISOString();
}

/**
 * One search: picks the issues whose figures can still move, asks the model for them, and
 * returns whatever survived the plausibility checks.
 */
export async function aiBoardSearch(bundled: IPO[], options: AiSearchOptions): Promise<AiSearchResult> {
  const started = Date.now();
  const key = options.key.trim();
  const now = options.now ?? new Date();
  const pinned = Boolean(options.providerId);
  const specs = pinned ? [providerSpec(options.providerId)] : candidatesForKey(key).slice(0, 2);
  const picks = picksForSearch(bundled, now, options.limit ?? 12);
  const prompt = boardPrompt(picks, { now, limit: options.limit ?? 12 });

  let last: AiSearchResult | null = null;

  for (const spec of specs) {
    const baseUrl = (options.baseUrl ?? '').trim() || spec.baseUrl;
    const wanted = options.search !== false && spec.search !== 'none';
    let model = (options.model ?? '').trim() || spec.modelFallback;

    let reply = await chat({ spec, baseUrl, model }, key, prompt, { ...options, search: wanted });
    let servedByFallback = false;

    // A model name can rot; when the provider says so, list what the key can reach and retry
    // once with the best of those instead of giving up on the key.
    if (!reply.ok && spec.listsModels && (reply.status === 400 || reply.status === 404)) {
      const listed = await listModels({ spec, baseUrl }, key, options);
      const discovered = listed.ok ? pickModel(listed.models, spec) : '';
      if (discovered && discovered !== model) {
        model = discovered;
        servedByFallback = true;
        reply = await chat({ spec, baseUrl, model }, key, prompt, { ...options, search: wanted });
      }
    }

    const attempt = baseResult(spec, model, reply.search, started);
    if (!reply.ok) {
      last = {
        ...attempt,
        error: reply.error,
        hint: reply.hint,
        raw: reply.raw,
        reasons: [...attempt.reasons, `${spec.label} did not answer: ${reply.error ?? 'unknown error'}`],
      };
      continue;
    }

    const extracted = extractRows(reply.text, { now, limit: options.limit ?? 40 });
    if (extracted.rows.length === 0) {
      last = {
        ...attempt,
        rejected: extracted.rejected,
        reasons: extracted.reasons,
        error: 'the model did not return any usable figures',
        raw: reply.text.slice(0, 600),
      };
      continue;
    }

    return {
      ...attempt,
      ok: true,
      rows: extracted.rows,
      rejected: extracted.rejected,
      reasons: extracted.reasons,
      asOf: newestStamp(extracted.rows),
      latencyMs: Date.now() - started,
      raw: reply.text.slice(0, 600),
      hint: servedByFallback ? `answered with ${model} after the default model was refused` : attempt.hint,
    };
  }

  return (
    last ?? {
      ...baseResult(specs[0] ?? providerSpec('custom'), '', false, started),
      error: 'no provider was tried',
    }
  );
}

/** One line for the source list in Settings: who answered, and how it went. */
export function aiSourceStatus(result: AiSearchResult): LiveSourceStatus {
  const note = result.ok
    ? `${result.providerLabel} • ${result.model}${result.search ? ' • web search' : ''}`
    : result.error;
  return {
    key: 'ai',
    label: SOURCE_LABELS.ai,
    ok: result.ok,
    rows: result.rows.length,
    asOf: result.asOf,
    error: result.ok ? undefined : result.error,
    note,
  };
}

/** The source row shown while the key exists but was not needed for this pull. */
export function aiIdleStatus(note: string): LiveSourceStatus {
  return { key: 'ai', label: SOURCE_LABELS.ai, ok: true, rows: 0, note };
}
