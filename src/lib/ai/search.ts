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
import {
  candidatesForKey,
  providerSpec,
  rankModels,
  searchCapability,
  searchModelFor,
  type AiProviderId,
  type AiProviderSpec,
} from './providers';

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
  /** how many models to try on one provider before giving up (default 3) */
  modelAttempts?: number;
  /** wall-clock cap for the model walk (default 75s) */
  searchBudgetMs?: number;
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
    let listedCache: string[] | null = null;
    /** the key's own model list, fetched at most once per provider per search */
    const discoveredModels = async (): Promise<string[]> => {
      if (listedCache) return listedCache;
      if (!spec.listsModels) return (listedCache = []);
      const listed = await listModels({ spec, baseUrl }, key, options);
      return (listedCache = listed.ok ? listed.models : []);
    };
    const wantsSearch = options.search !== false;
    let wanted = wantsSearch && spec.search !== 'none';
    let model = (options.model ?? '').trim() || spec.modelFallback;
    /** a model that searches inside the provider, picked because the provider has no search knob */
    let rescued: string | undefined;

    /**
     * A model with no web access answers from its training data, and a grey market premium
     * invented from training data is worse than no figure at all - the app says so and fills
     * nothing. The one reprieve: some providers ship a model that searches by itself (Groq's
     * compound), so look for one on the key's own model list before refusing.
     */
    if (wantsSearch && !wanted) {
      const hinted = searchModelFor(await discoveredModels(), spec);
      if (!hinted) {
        const refusal: AiSearchResult = {
          ...baseResult(spec, model, false, started),
          error: `${spec.label} cannot search the web (${searchCapability(spec)})`,
          hint: 'add a key that can search - Google Gemini, xAI, Perplexity, OpenRouter - or the board figures stay as they are',
          reasons: [
            `${spec.label} was not asked: ${searchCapability(spec)}`,
            'live figures are only filled by a search that can actually see the web',
          ],
        };
        last = refusal;
        if (pinned) return refusal;
        continue;
      }
      model = hinted;
      rescued = hinted;
      wanted = true;
    }

    /**
     * Which models to try, best first.
     *
     * The list comes from the key's own account, so it already knows what the provider serves
     * today: a hard-coded default goes stale the moment a model is retired ("gemini-2.5-flash
     * is no longer available to new users"), and the provider happily lists its replacement.
     * The user's pick still wins; after that it is newest-version-in-the-best-family.
     */
    // Only a real choice (the user's pick, or a search-capable model we found) is treated as
    // one: the spec's fallback string is a last resort, not a preference, and must not sit
    // ahead of the models the key can actually reach.
    const explicit = (options.model ?? '').trim();
    const fallback = explicit || spec.modelFallback;
    let candidates: string[] = [];
    if (rescued) {
      candidates = [rescued, ...(await discoveredModels()).filter((id) => id !== rescued)];
    } else if (spec.listsModels) {
      candidates = rankModels(await discoveredModels(), spec, explicit || null);
    }
    if (candidates.length === 0) candidates = [fallback];

    let reply = await chat({ spec, baseUrl, model: candidates[0] }, key, prompt, {
      ...options,
      search: wanted,
    });
    let servedByFallback = false;
    model = candidates[0];

    // One refusal is not a verdict on the key: providers retire model names and have demand
    // spikes per model. Try the next few, and stop early when the key itself was rejected.
    const searchAttempts = Math.max(1, Math.min(options.modelAttempts ?? 3, candidates.length));
    // three slow timeouts must not hold a refresh open indefinitely
    const deadline = started + (options.searchBudgetMs ?? 75000);
    for (const next of candidates.slice(1, searchAttempts)) {
      if (reply.ok) break;
      if (reply.status === 401 || reply.status === 403) break;
      if (Date.now() > deadline) break;
      reply = await chat({ spec, baseUrl, model: next }, key, prompt, { ...options, search: wanted });
      model = next;
      servedByFallback = true;
    }

    const attempt = baseResult(spec, model, reply.search || Boolean(rescued), started);
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
      hint: rescued
        ? `answered with ${rescued}, which searches for itself`
        : servedByFallback
          ? `answered with ${model} after the default model was refused`
          : attempt.hint,
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
    ? `${result.providerLabel} • ${result.model}${
        result.search ? ' • web search' : ' • answered from the model\'s memory'
      }`
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
