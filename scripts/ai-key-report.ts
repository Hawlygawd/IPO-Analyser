/**
 * CI / terminal report for the AI assist: does a key work, and does it return figures the
 * app can actually merge onto the board?
 *
 *   npx tsx scripts/ai-key-report.ts --keyless                 # no key needed: are the
 *                                                             # provider endpoints reachable?
 *   AI_KEY=... npx tsx scripts/ai-key-report.ts --strict       # full dry check + dry search
 *   npx tsx scripts/ai-key-report.ts --key sk-... --provider openai --model gpt-4o-mini
 *
 * `--keyless` prints what each provider's model endpoint answers without a key (a 401 is the
 * expected, healthy result: it proves the route works and the client maps the error), which is
 * the only form of this check that can run without a secret. Results land in the check-run
 * summary published by .github/workflows/ai-check.yml.
 */

import { checkKey, listModels, errorHint } from '../src/lib/ai/client';
import { aiBoardSearch } from '../src/lib/ai/search';
import { AI_PROVIDERS, describeKey } from '../src/lib/ai/providers';
import type { AiProviderId } from '../src/lib/ai/providers';
import { IPOT } from '../src/lib/ipoData';

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(name);
const value = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const key = value('--key') ?? process.env.AI_KEY ?? '';
const provider = value('--provider');
const model = value('--model');
const lines: string[] = [];
const started = Date.now();

async function keyless(): Promise<void> {
  lines.push('# AI provider reachability (no key)');
  lines.push('');
  lines.push('Every provider below is called with a deliberately invalid key. `HTTP 401` is the');
  lines.push('healthy answer: it proves the endpoint is reachable from a runner and that the app');
  lines.push('turns the provider error into something a person can read.');
  lines.push('');
  for (const spec of AI_PROVIDERS) {
    if (!spec.listsModels || !spec.baseUrl) continue;
    const listed = await listModels({ spec, baseUrl: spec.baseUrl }, 'invalid-key-for-reachability', {
      listTimeoutMs: 15000,
    });
    const status = listed.status === 0 ? 'no response' : `HTTP ${listed.status}`;
    const verdict = listed.status === 401 || listed.status === 403 ? 'reachable (rejects the fake key)' : listed.ok ? 'reachable (accepted!)' : 'check me';
    lines.push(`- **${spec.label}** (${spec.api} dialect): ${status} - ${verdict}`);
    lines.push(`  - message: ${String(listed.error ?? '').slice(0, 200)}`);
    lines.push(`  - hint the app would show: ${errorHint(listed.status, String(listed.error ?? '')) || '(none needed)'}`);
  }
}

async function withKey(): Promise<boolean> {
  lines.push('# AI assist dry check');
  lines.push('');
  lines.push(`Key shape: ${describeKey(key)}${provider ? ` (pinned to ${provider})` : ''}`);
  lines.push('');

  const check = await checkKey({
    key,
    providerId: (provider as AiProviderId | null) ?? null,
    model,
    maxCandidates: 4,
    listTimeoutMs: 20000,
    chatTimeoutMs: 60000,
  });
  lines.push(`## Key check: ${check.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`- provider: ${check.providerLabel} (${check.providerId})`);
  lines.push(`- model: ${check.model || '(none answered)'}`);
  lines.push(`- models visible to this key: ${check.models.length}`);
  lines.push(`- ${(check.latencyMs / 1000).toFixed(1)}s total`);
  for (const step of check.steps) {
    lines.push(`  - ${step.ok ? 'OK' : 'FAILED'} ${step.label}: ${step.detail}`);
  }
  if (!check.ok) {
    lines.push(`- error: ${check.error ?? 'unknown'}`);
    if (check.hint) lines.push(`- what the app would say: ${check.hint}`);
    for (const tried of check.tried) lines.push(`  - tried ${tried.label}: ${tried.error}`);
  }
  lines.push('');

  if (!check.ok) return false;

  const search = await aiBoardSearch(IPOT, {
    key,
    providerId: check.providerId,
    model: check.model,
    search: true,
    limit: 6,
    listTimeoutMs: 20000,
    chatTimeoutMs: 90000,
  });
  lines.push(`## Dry search: ${search.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`- ${search.providerLabel} • ${search.model}${search.search ? ' with web search' : ' without web search'}`);
  lines.push(`- rows returned: ${search.rows.length}, dropped as unverifiable: ${search.rejected}`);
  if (search.asOf) lines.push(`- newest reported stamp: ${search.asOf}`);
  if (search.error) lines.push(`- error: ${search.error}`);
  if (search.reasons.length) lines.push(`- parser notes: ${search.reasons.join(' | ')}`);
  for (const row of search.rows.slice(0, 8)) {
    lines.push(
      `  - ${row.name}: ${row.gmp !== undefined ? `GMP +₹${row.gmp}` : 'no premium'}` +
        `${row.subscriptionTotal !== undefined ? `, ${row.subscriptionTotal}x` : ''}` +
        `${row.closeDate ? `, closes ${row.closeDate}` : ''}` +
        `${row.sourceUrl ? ` (${row.sourceUrl})` : ''}`
    );
  }
  lines.push('');
  lines.push(
    search.ok
      ? 'The key works end to end: a refresh on a phone that cannot reach the boards will use these figures.'
      : 'The key authenticates but returned nothing usable - check the model name and whether web search is enabled for it.'
  );
  return search.ok;
}

async function main(): Promise<void> {
  lines.push('# AI assist report');
  lines.push('');
  lines.push(`Run ${new Date().toISOString()}${key ? ' with a key' : ' without a key'}`);
  lines.push('');

  if (flag('--keyless') || !key) {
    await keyless();
    lines.push('');
    lines.push(
      'No key was supplied, so no provider was actually used. Set AI_KEY (or pass `--key`) to run the full dry check.'
    );
  } else {
    const ok = await withKey();
    lines.push('');
    lines.push(`Finished in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    if (flag('--strict') && !ok) {
      console.log(lines.join('\n'));
      process.exit(1);
    }
  }

  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(`ai report failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
