/**
 * CI-only report: pulls the real upstream pages, runs the shipping parsers over them
 * and prints what the app would put on screen for this pull.
 *
 *   npx tsx scripts/live-report.ts
 *
 * The live-parse workflow runs exactly this on a GitHub runner (the dev sandbox cannot
 * reach ipoji.com) and publishes the output as a check run, so a change in the upstream
 * markup shows up as a failing review rather than as a phone showing stale numbers.
 */

import { DATA_AS_OF, DATA_AS_OF_LABEL, IPOT } from '../src/lib/ipoData';
import { istLabel, pullLiveBoard } from '../src/lib/live';

async function main() {
  const started = Date.now();
  const { board, parsed, fetched } = await pullLiveBoard(IPOT);
  const lines: string[] = [];

  lines.push(`# Live pull report`);
  lines.push('');
  lines.push(`Fetched in ${((Date.now() - started) / 1000).toFixed(1)}s at ${istLabel(new Date(fetched.fetchedAt).toISOString())}`);
  lines.push('');
  lines.push('## Sources');
  for (const source of board.sources) {
    lines.push(
      `- ${source.ok ? 'OK' : 'FAILED'} **${source.label}**: ${source.rows ?? 0} rows` +
        `${source.asOf ? `, stamp ${istLabel(source.asOf)}` : ''}${source.error ? ` (${source.error})` : ''}`
    );
  }
  lines.push('');

  lines.push('## Parsed');
  lines.push(`- GMP board: ${parsed.gmp.quoted} of ${parsed.gmp.tracked} tracked issues carry a quote`);
  lines.push(
    `- GMP quotes seen: ${parsed.gmp.rows
      .filter((row) => row.gmp !== undefined)
      .slice(0, 6)
      .map((row) => `${row.name} +₹${row.gmp}`)
      .join(', ')}`
  );
  lines.push(
    `- Subscription report: ${parsed.subscription.rows.length} rows, e.g. ${parsed.subscription.rows
      .slice(0, 3)
      .map((row) => `${row.name} ${row.total}x`)
      .join(', ')}`
  );
  lines.push(`- Current/upcoming cards: ${parsed.cards.length}`);
  lines.push(
    `- Calendar: ${parsed.calendar.length} days, ${parsed.calendar.reduce((sum, day) => sum + day.events.length, 0)} events`
  );
  lines.push('');

  lines.push('## Merged board');
  lines.push(`- ${board.ipos.length} issues (${board.updated} updated by this pull, ${board.added} discovered)`);
  lines.push(`- Newest upstream stamp: **${istLabel(board.asOf)}**`);
  const changed = board.ipos
    .filter((ipo) => {
      const bundled = IPOT.find((existing) => existing.id === ipo.id);
      return !bundled || bundled.gmp !== ipo.gmp || bundled.subscription?.total !== ipo.subscription?.total;
    })
    .slice(0, 10);
  for (const ipo of changed) {
    const bundled = IPOT.find((existing) => existing.id === ipo.id);
    lines.push(
      `  - ${ipo.name}: GMP ${bundled?.gmp ?? '—'} → ${ipo.gmp ?? 'no quote'}, ` +
        `subscription ${bundled?.subscription?.total ?? '—'}x → ${ipo.subscription?.total ?? '—'}x`
    );
  }
  lines.push('');
  lines.push(
    `Bundled snapshot is ${DATA_AS_OF_LABEL} (${DATA_AS_OF}); this pull is ${
      Date.parse(board.asOf) > Date.parse(DATA_AS_OF) ? '**NEWER**' : 'NOT newer'
    }.`
  );

  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(`live pull failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
