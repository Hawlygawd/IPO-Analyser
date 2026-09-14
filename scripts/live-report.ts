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
import { istLabel, pullLiveBoard, fetchLivePages, parseLivePages } from '../src/lib/live';

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
  const withBand = parsed.cards.filter((card) => card.bandHigh !== undefined).length;
  const withLot = parsed.cards.filter((card) => card.lotSize !== undefined).length;
  const withSize = parsed.cards.filter((card) => card.issueSizeCr !== undefined).length;
  const withSubs = parsed.cards.filter((card) => card.subscriptionTotal !== undefined).length;
  lines.push(
    `- Current/upcoming cards: ${parsed.cards.length} (band ${withBand}, lot ${withLot}, issue size ${withSize}, subscription ${withSubs})`
  );
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
  const sample = board.ipos.filter((ipo) => !IPOT.some((existing) => existing.id === ipo.id))[0];
  if (sample) {
    lines.push(
      `  - e.g. discovered ${sample.name}: band ${sample.priceBandLow ?? '—'}-${sample.priceBandHigh ?? '—'}, ` +
        `lot ${sample.lotSize ?? '—'}, issue ${sample.issueSizeCr ?? '—'} Cr, subscription ${sample.subscription?.total ?? '—'}x, ` +
        `platform ${sample.platform}, opens ${sample.openDate}`
    );
  }
  // Does the server serve the same tables to a client that cannot set a browser user agent
  // (a React Native build that ignores the header, for instance)?
  if (!process.argv.includes('--no-alt-agent')) {
    const alt = await fetchLivePages({ userAgent: 'okhttp/4.12.0' });
    const parsedAlt = parseLivePages(alt.pages);
    lines.push('');
    lines.push(
      `## Without a browser user agent (okhttp/4.12.0)`
    );
    lines.push(
      `- GMP rows ${parsedAlt.gmp.rows.length}, subscription rows ${parsedAlt.subscription.rows.length}, ` +
        `cards ${parsedAlt.cards.length}, calendar days ${parsedAlt.calendar.length}`
    );
    lines.push(
      `- ${Object.entries(alt.errors).map(([key, value]) => `${key}: ${value}`).join(', ') || 'no fetch errors'}`
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
