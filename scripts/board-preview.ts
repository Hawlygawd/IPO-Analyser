/**
 * Prints the board exactly as the app sees it today: phase, dates, premium and
 * subscription per issue. Handy when refreshing the snapshot in src/lib/ipoData.ts.
 *
 *   npm run board            # current tab buckets
 *   npm run board -- gmp     # premium ranking
 */
import { IPOT, DATA_AS_OF_LABEL } from '../src/lib/ipoData';
import { bucketBoard, boardStats, gmpBoardStats } from '../src/lib/board';
import { phaseOf, gmpSignal, sentiment, dataAge, nextMilestone } from '../src/lib/analysis';
import { formatDay, formatMultiple, formatPct, formatRupees, daysUntil, gmpPercent } from '../src/lib/format';

const mode = process.argv[2] ?? 'board';
const age = dataAge();

function header(title: string) {
  console.log(`\n${title}\n${'─'.repeat(Math.max(title.length, 40))}`);
}

function line(ipo: (typeof IPOT)[number]) {
  const phase = phaseOf(ipo);
  const pct = gmpPercent(ipo);
  const next = nextMilestone(ipo);
  const bits = [
    ipo.name.padEnd(38).slice(0, 38),
    ipo.platform.padEnd(8),
    phase.label.padEnd(17),
    (pct != null ? formatPct(pct) : ipo.gmp != null ? formatRupees(ipo.gmp) : '—').padStart(7),
    (ipo.subscription?.total != null ? formatMultiple(ipo.subscription.total) : '—').padStart(8),
    next ? `${next.label} in ${daysUntil(next.date)}d` : 'all dates passed',
  ];
  return bits.join(' ');
}

console.log(`IPO Pulse board • snapshot ${DATA_AS_OF_LABEL} (${age.label})`);
const stats = boardStats(IPOT);
console.log(
  `Issues: ${IPOT.length} | bidding now: ${stats.live} | opening soon: ${stats.openingSoon} | premium >= 12%: ${stats.healthyPremium}`
);
if (stats.closingToday) console.log(`Closing today: ${stats.closingToday.name}`);
if (stats.nextToOpen) console.log(`Next to open: ${stats.nextToOpen.name} on ${formatDay(stats.nextToOpen.openDate, true)}`);

if (mode === 'gmp') {
  const g = gmpBoardStats(IPOT);
  header(`GMP board (${g.quoted}/${g.total} quoted, average ${g.avg != null ? formatPct(g.avg) : '—'})`);
  [...IPOT]
    .sort((a, b) => (gmpPercent(b) ?? -999) - (gmpPercent(a) ?? -999))
    .forEach((ipo) => console.log(line(ipo)));
} else {
  const board = bucketBoard(IPOT);
  for (const [title, rows] of [
    ['Bidding now', board.open],
    ['Opening soon', board.soon],
    ['Closed - allotment / listing', board.closed],
  ] as const) {
    header(`${title} (${rows.length})`);
    rows.forEach((ipo) => console.log(line(ipo)));
  }
}

header('Analysis spot-check');
for (const id of ['nse', 'kanohar-electricals', 'panchatv-bharat']) {
  const ipo = IPOT.find((i) => i.id === id);
  if (!ipo) continue;
  const mood = sentiment(ipo);
  console.log(`${ipo.name}: ${mood.label} (${mood.score}/100) - ${gmpSignal(ipo).detail}`);
}
