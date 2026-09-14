/**
 * One registry for every bring-your-own-key AI provider the app can talk to.
 *
 * The point of this file is that the user never has to tell the app which vendor a key
 * belongs to: `candidatesForKey()` reads the key's shape, and `checkKey()` in client.ts
 * tries the plausible providers in order until one of them answers, so a fresh Gemini,
 * OpenAI, NVIDIA, Grok, Groq, OpenRouter, Claude, Mistral, DeepSeek, Together,
 * Perplexity or Cerebras key all work the same way - paste, save, test.
 *
 * Nothing here touches the network or react-native: this module also runs in the CI job
 * that exercises the real provider endpoints (scripts/ai-key-report.ts).
 */

export type AiProviderId =
  | 'gemini'
  | 'openai'
  | 'xai'
  | 'nvidia'
  | 'groq'
  | 'openrouter'
  | 'anthropic'
  | 'mistral'
  | 'deepseek'
  | 'together'
  | 'perplexity'
  | 'cerebras'
  | 'custom';

/** Which request/response dialect the provider speaks. */
export type AiApiShape = 'openai' | 'gemini' | 'anthropic';

/** Where the API key travels. */
export type AiAuthStyle = 'bearer' | 'gemini-key-header' | 'anthropic-header' | 'optional-bearer';

/** How to ask this provider to search the live web while answering. */
export type AiSearchMode =
  | 'google-grounding'
  | 'x-live-search'
  | 'anthropic-tool'
  | 'online-suffix'
  | 'built-in'
  | 'none';

export interface AiProviderSpec {
  id: AiProviderId;
  label: string;
  /** Console page where a key is created - shown in Settings with a copyable hint. */
  consoleUrl: string;
  /** What the provider gives away, in the provider's own terms. */
  freeTier: string;
  baseUrl: string;
  api: AiApiShape;
  auth: AiAuthStyle;
  /** Key shapes that point at this provider; first match in AI_PROVIDERS order wins. */
  keyPrefixes: string[];
  /** True when the provider exposes a model list endpoint we can use as a dry check. */
  listsModels: boolean;
  /** Model ids tried before the discovered list is used, best first (substring match). */
  modelPreference: string[];
  /** Last resort when discovery fails, so a check can still run. */
  modelFallback: string;
  /** True when a max token cap must be sent (Anthropic), false when it only causes 400s. */
  tokenCap: 'max_tokens' | 'max_completion_tokens' | 'none';
  search: AiSearchMode;
  /**
   * Models that search the web by themselves, even though the provider has no search knob
   * (Groq's `compound` answers with live web results). Checked before the app refuses to use a
   * provider for figures: a model that cannot search must not be asked to guess them.
   */
  searchModelHints?: string[];
  /** Sent with every request (OpenRouter's attribution headers, for instance). */
  extraHeaders?: Record<string, string>;
  /** Providers whose API cannot be called from a browser at all. */
  browserBlocked?: boolean;
}

export const AI_PROVIDERS: AiProviderSpec[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    consoleUrl: 'https://aistudio.google.com/apikey',
    freeTier: 'free tier in Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    api: 'gemini',
    auth: 'gemini-key-header',
    keyPrefixes: ['AIza', 'AQ.'],
    listsModels: true,
    // families, not versions: the newest id in each family wins (gemini-3.6-flash beats
    // gemini-2.5-flash), because Google retires the old names for new keys with no notice
    modelPreference: ['gemini-flash-lite', 'gemini-flash', 'gemini-pro'],
    modelFallback: 'gemini-flash-latest',
    tokenCap: 'none',
    search: 'google-grounding',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    consoleUrl: 'https://platform.openai.com/api-keys',
    freeTier: 'paid key (project credits)',
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: ['sk-proj-', 'sk-svcacct-', 'sk-'],
    listsModels: true,
    modelPreference: ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o'],
    modelFallback: 'gpt-4o-mini',
    tokenCap: 'none',
    search: 'none',
    browserBlocked: true,
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    consoleUrl: 'https://console.x.ai',
    freeTier: 'free credits on new xAI accounts',
    baseUrl: 'https://api.x.ai/v1',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: ['xai-'],
    listsModels: true,
    modelPreference: ['grok-4-fast', 'grok-3-mini', 'grok-4', 'grok-3', 'grok-2-1212'],
    modelFallback: 'grok-3-mini',
    tokenCap: 'none',
    search: 'x-live-search',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    consoleUrl: 'https://build.nvidia.com',
    freeTier: '1,000 free inference credits',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: ['nvapi-'],
    listsModels: true,
    modelPreference: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.3-nemotron', 'meta/llama-3.1-8b-instruct'],
    modelFallback: 'meta/llama-3.3-70b-instruct',
    tokenCap: 'max_tokens',
    search: 'none',
  },
  {
    id: 'groq',
    label: 'Groq',
    consoleUrl: 'https://console.groq.com/keys',
    freeTier: 'free tier with per-minute limits',
    baseUrl: 'https://api.groq.com/openai/v1',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: ['gsk_'],
    listsModels: true,
    modelPreference: ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'],
    modelFallback: 'llama-3.3-70b-versatile',
    tokenCap: 'max_tokens',
    search: 'none',
    // Groq's own agentic models run web search internally, which is the only way a Groq key can
    // answer with live figures at all
    searchModelHints: ['compound'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    consoleUrl: 'https://openrouter.ai/keys',
    freeTier: 'many :free models',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: ['sk-or-'],
    listsModels: true,
    modelPreference: [':free', 'gemini-flash', 'gpt-oss-20b', 'llama-3.3-70b', 'claude-haiku'],
    modelFallback: 'google/gemini-2.5-flash',
    tokenCap: 'max_tokens',
    search: 'online-suffix',
    extraHeaders: { 'HTTP-Referer': 'https://github.com/Hawlygawd/IPO-Analyser', 'X-Title': 'IPO Pulse' },
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    freeTier: 'paid key (small starter credit)',
    baseUrl: 'https://api.anthropic.com/v1',
    api: 'anthropic',
    auth: 'anthropic-header',
    keyPrefixes: ['sk-ant-'],
    listsModels: true,
    modelPreference: ['claude-haiku-4-5', 'claude-3-5-haiku', 'claude-sonnet-4', 'claude-3-5-sonnet'],
    modelFallback: 'claude-3-5-haiku-latest',
    tokenCap: 'max_tokens',
    search: 'anthropic-tool',
    browserBlocked: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    freeTier: 'free experiment plan',
    baseUrl: 'https://api.mistral.ai/v1',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: [],
    listsModels: true,
    modelPreference: ['mistral-small-latest', 'open-mistral-nemo', 'mistral-large-latest'],
    modelFallback: 'mistral-small-latest',
    tokenCap: 'max_tokens',
    search: 'none',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    freeTier: 'prepaid key (very low cost)',
    baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: [],
    listsModels: true,
    modelPreference: ['deepseek-chat'],
    modelFallback: 'deepseek-chat',
    tokenCap: 'max_tokens',
    search: 'none',
  },
  {
    id: 'together',
    label: 'Together AI',
    consoleUrl: 'https://api.together.ai/settings/api-keys',
    freeTier: 'starter credit, some free models',
    baseUrl: 'https://api.together.xyz/v1',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: [],
    listsModels: true,
    modelPreference: ['free', 'llama-3.3-70b-instruct-turbo', 'llama-3.1-8b-instruct-turbo'],
    modelFallback: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    tokenCap: 'max_tokens',
    search: 'none',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    consoleUrl: 'https://www.perplexity.ai/settings/api',
    freeTier: 'paid key (search included in every call)',
    baseUrl: 'https://api.perplexity.ai',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: ['pplx-'],
    listsModels: false,
    modelPreference: ['sonar'],
    modelFallback: 'sonar',
    tokenCap: 'max_tokens',
    search: 'built-in',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    consoleUrl: 'https://cloud.cerebras.ai',
    freeTier: 'free tier (daily token allowance)',
    baseUrl: 'https://api.cerebras.ai/v1',
    api: 'openai',
    auth: 'bearer',
    keyPrefixes: ['csk-'],
    listsModels: true,
    modelPreference: ['llama3.1-8b', 'llama-3.3-70b', 'qwen-3'],
    modelFallback: 'llama3.1-8b',
    tokenCap: 'max_tokens',
    search: 'none',
  },
  {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    consoleUrl: '',
    freeTier: 'whatever your endpoint offers',
    baseUrl: '',
    api: 'openai',
    auth: 'optional-bearer',
    keyPrefixes: [],
    listsModels: true,
    modelPreference: [],
    modelFallback: '',
    tokenCap: 'max_tokens',
    search: 'none',
  },
];

export const PROVIDER_BY_ID: Record<AiProviderId, AiProviderSpec> = AI_PROVIDERS.reduce(
  (acc, spec) => {
    acc[spec.id] = spec;
    return acc;
  },
  {} as Record<AiProviderId, AiProviderSpec>
);

/** Providers that brand their keys, most specific prefix first. */
const PREFIX_HINTS: { prefix: string; ids: AiProviderId[] }[] = [
  { prefix: 'sk-ant-', ids: ['anthropic'] },
  { prefix: 'sk-or-', ids: ['openrouter'] },
  { prefix: 'sk-proj-', ids: ['openai'] },
  { prefix: 'sk-svcacct-', ids: ['openai'] },
  { prefix: 'sk-admin-', ids: ['openai'] },
  { prefix: 'gsk_', ids: ['groq'] },
  { prefix: 'xai-', ids: ['xai'] },
  { prefix: 'nvapi-', ids: ['nvidia'] },
  { prefix: 'pplx-', ids: ['perplexity'] },
  { prefix: 'csk-', ids: ['cerebras'] },
  { prefix: 'AIza', ids: ['gemini'] },
  { prefix: 'AQ.', ids: ['gemini'] },
  // a bare sk- key is OpenAI's classic shape, but DeepSeek, Together and Mistral hand out
  // the same shape - so list them all and let the dry check find the one that answers
  { prefix: 'sk-', ids: ['openai', 'deepseek', 'together'] },
];

export function providerSpec(id: AiProviderId | string | null | undefined): AiProviderSpec {
  if (id && Object.prototype.hasOwnProperty.call(PROVIDER_BY_ID, id)) {
    return PROVIDER_BY_ID[id as AiProviderId];
  }
  return PROVIDER_BY_ID.custom;
}

/** Cheap sanity check, so a pasted sentence is rejected before it is ever stored. */
export function looksLikeKey(raw: string): boolean {
  const key = raw.trim();
  if (key.length < 16 || key.length > 512) return false;
  if (/\s/.test(key)) return false;
  return /^[A-Za-z0-9._\-:+/=]+$/.test(key);
}

/**
 * Every provider whose key shape matches, most likely first. The dry check walks this
 * list until a provider accepts the key, which is what makes one input box work for
 * every vendor.
 */
export function candidatesForKey(raw: string): AiProviderSpec[] {
  const key = raw.trim();
  const ids: AiProviderId[] = [];
  for (const hint of PREFIX_HINTS) {
    if (key.startsWith(hint.prefix)) {
      for (const id of hint.ids) if (!ids.includes(id)) ids.push(id);
      break;
    }
  }
  if (ids.length === 0 && /^[A-Za-z0-9_-]{20,}$/.test(key)) {
    // unlabelled 20+ char token: the usual shape for Mistral / Together / self-hosted keys
    ids.push('mistral', 'together', 'openai', 'custom');
  }
  const specs = ids.map((id) => PROVIDER_BY_ID[id]).filter(Boolean);
  if (specs.length === 0) return [PROVIDER_BY_ID.custom];
  if (!specs.some((spec) => spec.id === 'custom')) specs.push(PROVIDER_BY_ID.custom);
  return specs;
}

/** The single best guess, for the Settings UI (the dry check is what really decides). */
export function detectProvider(raw: string): AiProviderSpec | null {
  const key = raw.trim();
  if (!looksLikeKey(key)) return null;
  const [first] = candidatesForKey(key);
  return first.id === 'custom' ? null : first;
}

/** "Google Gemini" or "unrecognised - will be tested against every provider". */
export function describeKey(raw: string): string {
  const guess = detectProvider(raw);
  return guess ? guess.label : 'Unrecognised shape - checked against every provider';
}

/* --------------------------------------------------------------- model picking */

/** "models/gemini-3.6-flash" -> "geminiflash": the family a version is a member of. */
function familyKey(id: string): string {
  return id
    .replace(/^models\//, '')
    .toLowerCase()
    .replace(/[\d.]+/g, '')
    .replace(/[^a-z]+/g, '');
}

/**
 * The version a model id advertises: "gemini-3.6-flash" -> 3.06, "gpt-5.1-mini" -> 5.01,
 * "llama-3.3-70b" -> 3.03 (the 70b is a parameter count, not a version). Ids with no version
 * at all ("gpt-oss-20b" style aliases) score 0 so a numbered family always outranks them.
 */
export function modelVersion(id: string): number {
  const cleaned = id.replace(/^models\//, '');
  const matches = [...cleaned.matchAll(/(\d+)(?:[.-](\d+))?/g)];
  for (const match of matches) {
    const major = Number(match[1]);
    const after = cleaned.slice((match.index ?? 0) + match[0].length);
    // "70b" / "8b" are parameter counts; keep looking for a version
    if (/^b\b/i.test(after) && major > 10) continue;
    const minor = match[2] ? Number(match[2]) : 0;
    return major + Math.min(minor, 99) / 100;
  }
  return 0;
}

/**
 * Every model on the key's list, best first.
 *
 * This is the answer to model rot: providers retire names ("gemini-2.5-flash is no longer
 * available to new users") faster than any app can ship a release, advertise the successor in
 * the error text, and list it in the model list we already fetched. So the preference list
 * names *families* (flash, mini, sonar, compound...) and the newest version inside each family
 * is chosen - an explicit pick by the user still wins.
 */
export function rankModels(models: string[], spec: AiProviderSpec, chosen?: string | null): string[] {
  const ids: string[] = [];
  for (const raw of models) {
    const id = raw.replace(/^models\//, '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  const families = spec.modelPreference.map(familyKey);
  const scored = ids
    .filter((id) => !EXCLUDED_MODEL.test(id))
    .map((id) => {
      const family = familyKey(id);
      const rank = families.findIndex((candidate) => family.includes(candidate));
      return {
        id,
        rank: rank === -1 ? families.length : rank,
        version: modelVersion(id),
        length: id.length,
      };
    });
  scored.sort((a, b) => a.rank - b.rank || b.version - a.version || a.length - b.length);

  const ranked = scored.map((entry) => entry.id);
  const usable = ranked.length > 0 ? ranked : ids;
  const wanted = (chosen ?? '').trim().replace(/^models\//, '');
  if (!wanted) return usable;
  return [wanted, ...usable.filter((id) => id !== wanted)];
}

/** The first model worth trying: the user's pick, else the newest of the best family. */
export function pickModel(models: string[], spec: AiProviderSpec, chosen?: string | null): string {
  return rankModels(models, spec, chosen)[0] ?? spec.modelFallback;
}

/**
 * How many models the app will try before it gives up on a provider. Providers retire and
 * overload individual models, so a couple of fallbacks turn "key failed" into "it answered".
 */
export const MODEL_ATTEMPT_LIMIT = 6;

/** Models that cannot answer a text question, so they must never be picked automatically. */
export const EXCLUDED_MODEL =
  /(embed|whisper|tts|audio|transcri|rerank|moderation|image|vision-|dall|sora|stable-|clip|guard|deprecat|realtime)/i;

/** Models that are worth listing in the Settings picker. */
export function selectableModels(models: string[]): string[] {
  return models
    .map((model) => model.replace(/^models\//, ''))
    .filter((model) => !EXCLUDED_MODEL.test(model))
    .slice(0, 60);
}

/**
 * A model id on this provider's list that searches the web by itself, if any.
 * Checked before the app gives up on a provider that has no search parameter.
 */
export function searchModelFor(models: string[], spec: AiProviderSpec): string | undefined {
  const hints = spec.searchModelHints ?? [];
  if (hints.length === 0) return undefined;
  const usable = models.filter((id) => !/embed|whisper|tts|guard|moderation/i.test(id));
  for (const hint of hints) {
    const matches = usable.filter((id) => id.toLowerCase().includes(hint.toLowerCase()));
    // "groq/compound-mini" and "groq/compound" both match: the newest full model wins
    if (matches.length) return matches.sort((a, b) => modelVersion(b) - modelVersion(a) || a.length - b.length)[0];
  }
  return undefined;
}

/** Can this provider's key answer with live figures at all, and how? */
export function canSearchWeb(spec: AiProviderSpec): boolean {
  return spec.search !== 'none' || (spec.searchModelHints?.length ?? 0) > 0;
}

/** One line, for the key card, saying what this provider can do about live data. */
export function searchCapability(spec: AiProviderSpec): string {
  switch (spec.search) {
    case 'google-grounding':
      return 'searches Google for live results';
    case 'x-live-search':
      return 'searches X posts live';
    case 'anthropic-tool':
      return 'runs its own web_search tool';
    case 'online-suffix':
      return 'searches the web through :online models';
    case 'built-in':
      return 'has search built into its models';
    default:
      return spec.searchModelHints?.length
        ? `cannot search by itself - only through a search-capable model (${spec.searchModelHints.join(', ')})`
        : 'cannot search the web, so it is never asked to guess live figures';
  }
}
