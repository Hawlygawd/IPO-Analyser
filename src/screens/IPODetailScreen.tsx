import { useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { radius, Theme } from '../theme';
import { useStore } from '../lib/store';
import { getIpo, DATA_AS_OF_LABEL } from '../lib/ipoData';
import {
  formatCr,
  formatDay,
  formatIstTime,
  formatPct,
  formatRupees,
  gmpPercent,
  indicativeListing,
  lotInvestment,
  priceBandLabel,
} from '../lib/format';
import {
  allotmentOdds,
  dateLine,
  gmpSignal,
  gmpUpdatedLabel,
  insights,
  nextMilestone,
  phaseOf,
  phaseTone,
  sentiment,
  sentimentTone,
  subscriptionRows,
} from '../lib/analysis';
import { Avatar, Button, Chip, KeyValueRow, MicroLabel, ProgressMeter, Row, SectionCard, numeric } from '../components/ui';
import { PriceLadder, SubscriptionBars } from '../components/Charts';
import { MilestoneTimeline } from '../components/Milestone';
import { ScreenHeader } from '../components/ScreenHeader';
import { RootStackParamList } from '../navigation/types';

/** Retail investors can bid for at most ₹2 lakh in an IPO (SEBI limit). */
const RETAIL_CAP = 200000;

export function IPODetailScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'IPODetail'>>();
  const insets = useSafeAreaInsets();
  const { isWatched, toggleWatch, permission, showToast, enableNotifications } = useStore();
  const [lots, setLots] = useState(1);

  const ipo = getIpo(route.params.id);

  const analysis = useMemo(() => {
    if (!ipo) return null;
    return {
      signal: gmpSignal(ipo),
      sentiment: sentiment(ipo),
      points: insights(ipo),
      rows: subscriptionRows(ipo),
      odds: allotmentOdds(ipo),
    };
  }, [ipo]);

  if (!ipo || !analysis) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScreenHeader theme={theme} title="IPO" onBack={() => navigation.goBack()} />
        <Text style={{ color: theme.textSub, textAlign: 'center', marginTop: 40 }}>This IPO is no longer available.</Text>
      </View>
    );
  }

  const phase = phaseOf(ipo);
  const pct = gmpPercent(ipo);
  const watched = isWatched(ipo.id);
  const milestone = nextMilestone(ipo);
  const oneLot = lotInvestment(ipo);
  const cost = lotInvestment(ipo, lots);
  const listing = indicativeListing(ipo);
  const moodTone = sentimentTone(analysis.sentiment.score);
  const overRetailCap = cost != null && cost > RETAIL_CAP;

  const shareText = [
    `${ipo.name} (${ipo.platform} ${ipo.segment})`,
    priceBandLabel(ipo),
    ipo.gmp != null
      ? `Grey market premium ${formatRupees(ipo.gmp)}${pct != null ? ` (${formatPct(pct)})` : ''}`
      : 'No grey market quote recorded',
    listing != null ? `Indicative listing ${formatRupees(listing)}` : null,
    `${dateLine(ipo)} • source: ${ipo.sourceName}`,
    `Shared from IPO Pulse (snapshot ${DATA_AS_OF_LABEL})`,
  ]
    .filter(Boolean)
    .join('\n');

  const onShare = async () => {
    try {
      await Share.share({ message: shareText });
      return;
    } catch {
      // fall through to the clipboard / toast fallback
    }
    const clipboard = (globalThis as any)?.navigator?.clipboard;
    if (Platform.OS === 'web' && clipboard?.writeText) {
      try {
        await clipboard.writeText(shareText);
        showToast('Details copied to the clipboard', 'up');
        return;
      } catch {
        // ignore and fall through
      }
    }
    showToast('Sharing is not available on this device', 'warn');
  };

  const onOpenSource = async () => {
    try {
      await Linking.openURL(ipo.sourceUrl);
    } catch {
      showToast('Could not open the source link', 'down');
    }
  };

  const facts: { label: string; value: string }[] = [
    { label: 'Issue type', value: ipo.issueType ?? 'TBA' },
    { label: 'Platform', value: `${ipo.platform} • lists on ${ipo.exchanges.join(' & ')}` },
    { label: 'Lot size', value: ipo.lotSize != null ? `${ipo.lotSize} shares` : 'TBA' },
    { label: 'Min. investment', value: oneLot != null ? formatRupees(Math.round(oneLot)) : 'TBA' },
    { label: 'Price band', value: priceBandLabel(ipo) },
    { label: 'Issue size', value: formatCr(ipo.issueSizeCr) },
    ...(ipo.sector ? [{ label: 'Sector', value: ipo.sector }] : []),
    { label: 'Bidding window', value: `${formatDay(ipo.openDate)} – ${formatDay(ipo.closeDate)}` },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        title={ipo.name}
        subtitle={`${ipo.platform} • ${ipo.sector ?? ipo.segment}`}
        onBack={() => navigation.goBack()}
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {!watched ? (
              <Pressable
                onPress={() => toggleWatch(ipo)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Add ${ipo.name} to watchlist and set reminders`}
                style={({ pressed }) => [
                  styles.iconBtn,
                  { backgroundColor: theme.card, borderColor: theme.border },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons name="star-outline" size={18} color={theme.text} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={onShare}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Share these IPO details"
              style={({ pressed }) => [
                styles.iconBtn,
                { backgroundColor: theme.card, borderColor: theme.border },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="share-outline" size={18} color={theme.text} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Animated.View
          entering={FadeInDown.duration(300)}
          style={[styles.hero, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Row style={{ gap: 12 }} align="flex-start">
            <Avatar name={ipo.name} theme={theme} size={52} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: theme.text, letterSpacing: -0.3 }} numberOfLines={2}>
                {ipo.name}
              </Text>
              <Text style={{ fontSize: 12, color: theme.textMuted, marginTop: 3, fontWeight: '600' }}>
                {dateLine(ipo)}
              </Text>
              <Row style={{ gap: 6, marginTop: 7 }} wrap>
                <Chip label={phase.label} tone={phaseTone(phase.key)} theme={theme} small />
                <Chip label={ipo.segment} tone="neutral" theme={theme} small />
                {milestone ? (
                  <Chip label={`${milestone.label} ${formatDay(milestone.date)}`} tone="info" theme={theme} small />
                ) : null}
              </Row>
            </View>
          </Row>

          <View style={{ marginTop: 14 }}>
            <PriceLadder ipo={ipo} theme={theme} />
          </View>

          <View style={[styles.heroStats, { borderTopColor: theme.border }]}>
            <HeroStat
              theme={theme}
              label="GMP"
              value={ipo.gmp != null ? `${ipo.gmp > 0 ? '+' : ipo.gmp < 0 ? '−' : ''}${formatRupees(Math.abs(ipo.gmp))}` : '—'}
              sub={pct != null ? formatPct(pct) : 'band TBA'}
              tone={analysis.signal.tone === 'down' ? 'down' : analysis.signal.tone === 'up' ? 'up' : undefined}
            />
            <HeroStat
              theme={theme}
              label="Indicative list"
              value={listing != null ? formatRupees(listing) : '—'}
              sub={ipo.priceBandHigh != null ? `vs band ${formatRupees(ipo.priceBandHigh)}` : 'band TBA'}
            />
            <HeroStat
              theme={theme}
              label="Min. lot"
              value={oneLot != null ? formatRupees(Math.round(oneLot)) : 'TBA'}
              sub={ipo.lotSize != null ? `${ipo.lotSize} shares` : 'lot size TBA'}
            />
          </View>
        </Animated.View>

        {/* Analysis */}
        <Animated.View entering={FadeInDown.delay(50).duration(300)}>
          <SectionCard
            theme={theme}
            title="Demand signal"
            subtitle="Derived from the premium and the recorded subscription - not a prediction"
            right={
              <Chip
                label={`${analysis.sentiment.label} ${analysis.sentiment.score}`}
                tone={moodTone}
                theme={theme}
                small
              />
            }
            style={{ marginTop: 14 }}
          >
            <ProgressMeter
              value={analysis.sentiment.score}
              tone={moodTone}
              theme={theme}
              accessibilityLabel={`Demand score ${analysis.sentiment.score} out of 100: ${analysis.sentiment.label}`}
            />
            <Row justify="space-between" style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 10.5, color: theme.textMuted, fontWeight: '700' }}>WEAK</Text>
              <Text style={{ fontSize: 10.5, color: theme.textMuted, fontWeight: '700' }}>STRONG</Text>
            </Row>

            <View style={{ marginTop: 14, gap: 8 }}>
              {analysis.sentiment.reasons.map((reason) => (
                <Row key={reason} gap={8} align="flex-start">
                  <Ionicons name="ellipse" size={6} color={theme.primary} style={{ marginTop: 6 }} />
                  <Text style={{ flex: 1, fontSize: 12.5, color: theme.textSub, lineHeight: 18 }}>{reason}</Text>
                </Row>
              ))}
            </View>

            <View style={[styles.noteBox, { backgroundColor: theme.cardAlt }]}>
              <Ionicons name="information-circle-outline" size={15} color={theme.info} />
              <Text style={{ flex: 1, fontSize: 11.5, color: theme.textSub, lineHeight: 17 }}>
                {analysis.signal.detail}
                {ipo.gmpUpdated ? ` (${gmpUpdatedLabel(ipo)})` : ''}
              </Text>
            </View>

            <View style={{ marginTop: 16, gap: 8 }}>
              {analysis.points.map((point) => (
                <Row key={point} gap={8} align="flex-start">
                  <Ionicons name="checkmark-circle" size={15} color={theme.primary} style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, fontSize: 13, color: theme.textSub, lineHeight: 19 }}>{point}</Text>
                </Row>
              ))}
            </View>
          </SectionCard>
        </Animated.View>

        {/* Lot calculator */}
        {oneLot != null ? (
          <Animated.View entering={FadeInDown.delay(90).duration(300)}>
            <SectionCard
              theme={theme}
              title="What would it cost?"
              subtitle={`${ipo.lotSize} shares a lot at the upper band of ${formatRupees(ipo.priceBandHigh ?? 0)}`}
              style={{ marginTop: 14 }}
            >
              <Row justify="space-between">
                <View>
                  <MicroLabel theme={theme}>Lots to apply for</MicroLabel>
                  <Row gap={12} style={{ marginTop: 8 }}>
                    <Stepper
                      icon="remove"
                      theme={theme}
                      label="Decrease the number of lots"
                      disabled={lots <= 1}
                      onPress={() => setLots((n) => Math.max(1, n - 1))}
                    />
                    <Text style={[styles.lotsValue, numeric, { color: theme.text }]}>{lots}</Text>
                    <Stepper
                      icon="add"
                      theme={theme}
                      label="Increase the number of lots"
                      disabled={lots >= 20}
                      onPress={() => setLots((n) => Math.min(20, n + 1))}
                    />
                  </Row>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <MicroLabel theme={theme}>You pay</MicroLabel>
                  <Text style={[styles.costValue, numeric, { color: overRetailCap ? theme.down : theme.text }]}>
                    {formatRupees(Math.round(cost ?? 0))}
                  </Text>
                  <Text style={{ fontSize: 10.5, color: theme.textMuted, fontWeight: '600' }}>
                    {lots} × {formatRupees(Math.round(oneLot))}
                  </Text>
                </View>
              </Row>

              <View style={[styles.noteBox, { backgroundColor: overRetailCap ? theme.downSoft : theme.cardAlt, marginTop: 12 }]}>
                <Ionicons
                  name={overRetailCap ? 'alert-circle-outline' : 'information-circle-outline'}
                  size={15}
                  color={overRetailCap ? theme.down : theme.info}
                />
                <Text style={{ flex: 1, fontSize: 11.5, color: theme.textSub, lineHeight: 17 }}>
                  {overRetailCap
                    ? `Above the ₹2,00,000 retail limit - this application would move into the NII (HNI) category.`
                    : `Retail applications can go up to ₹2,00,000 (about ${Math.floor(RETAIL_CAP / oneLot)} lots here). The amount is blocked in your bank until allotment, not debited.`}
                </Text>
              </View>
            </SectionCard>
          </Animated.View>
        ) : null}

        {/* Subscription */}
        <Animated.View entering={FadeInDown.delay(120).duration(300)}>
          <SectionCard
            theme={theme}
            title="Subscription"
            subtitle={ipo.subscription?.asOf ? `Recorded ${ipo.subscription.asOf}` : undefined}
            right={
              ipo.subscription?.asOf ? <Chip label="Category-wise" tone="info" theme={theme} small /> : undefined
            }
            style={{ marginTop: 14 }}
          >
            {analysis.rows.length > 0 ? (
              <>
                <SubscriptionBars rows={analysis.rows} theme={theme} />
                {analysis.odds ? (
                  <Text style={{ fontSize: 12, color: theme.textSub, marginTop: 14, lineHeight: 18 }}>
                    {analysis.odds}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={{ fontSize: 13, color: theme.textSub, lineHeight: 20 }}>
                {phase.key === 'upcoming'
                  ? 'Bidding has not opened yet. Category-wise subscription appears here from the opening day.'
                  : 'No category-wise subscription figures were published for this issue by the tracker.'}
              </Text>
            )}
          </SectionCard>
        </Animated.View>

        {/* Timeline */}
        <Animated.View entering={FadeInDown.delay(150).duration(300)}>
          <SectionCard theme={theme} title="Key dates" style={{ marginTop: 14 }}>
            <MilestoneTimeline ipo={ipo} theme={theme} />
          </SectionCard>
        </Animated.View>

        {/* Facts */}
        <Animated.View entering={FadeInDown.delay(180).duration(300)}>
          <SectionCard theme={theme} title="Issue facts" style={{ marginTop: 14 }}>
            <Text style={{ fontSize: 13.5, color: theme.textSub, lineHeight: 20.5 }}>{ipo.about}</Text>
            <View style={{ marginTop: 10 }}>
              {facts.map((fact) => (
                <KeyValueRow key={fact.label} theme={theme} label={fact.label} value={fact.value} />
              ))}
            </View>
          </SectionCard>
        </Animated.View>

        {/* Source */}
        <Animated.View entering={FadeInDown.delay(210).duration(300)}>
          <SectionCard theme={theme} title="Where this came from" style={{ marginTop: 14 }}>
            <KeyValueRow theme={theme} label="Source" value={ipo.sourceName} />
            <KeyValueRow theme={theme} label="Board snapshot" value={DATA_AS_OF_LABEL} />
            {ipo.gmpUpdated ? (
              <KeyValueRow theme={theme} label="GMP quote recorded" value={`${formatIstTime(ipo.gmpUpdated)} IST`} />
            ) : null}
            <Button
              theme={theme}
              label="Open the source page"
              variant="ghost"
              icon="open-outline"
              onPress={onOpenSource}
              style={{ marginTop: 12 }}
            />
            <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 10, lineHeight: 16 }}>
              Figures are a copy of what the tracker published on the snapshot date. Always confirm dates and
              subscription on the exchange or registrar before you bid.
            </Text>
          </SectionCard>
        </Animated.View>

        <Text style={[styles.disclaimer, { color: theme.textMuted }]}>
          Grey market premiums are unofficial, unregulated and can change without notice. Nothing in this app is
          investment advice.
        </Text>
      </ScrollView>

      {/* Sticky action bar */}
      <View
        style={[
          styles.actionBar,
          {
            backgroundColor: theme.card,
            borderTopColor: theme.border,
            paddingBottom: Math.max(insets.bottom, 14),
          },
        ]}
      >
        <Button
          theme={theme}
          label={watched ? 'Watching' : 'Watch + reminders'}
          icon={watched ? 'star' : 'star-outline'}
          variant={watched ? 'soft' : 'primary'}
          onPress={() => toggleWatch(ipo)}
          accessibilityHint={
            watched ? 'Stops reminders for this IPO' : 'Adds this IPO and queues reminders for its key dates'
          }
          style={{ flex: 1 }}
        />
        {watched && (permission === 'denied' || permission === 'undetermined') ? (
          <Button
            theme={theme}
            label="Enable alerts"
            variant="ghost"
            icon="notifications-outline"
            onPress={enableNotifications}
            accessibilityHint="Asks the system for permission to post reminders"
          />
        ) : null}
      </View>
    </View>
  );
}

function Stepper({
  icon,
  onPress,
  theme,
  label,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  theme: Theme;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        {
          width: 38,
          height: 38,
          borderRadius: 19,
          borderWidth: 1,
          borderColor: disabled ? theme.border : theme.primary,
          backgroundColor: disabled ? theme.cardAlt : theme.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={disabled ? theme.textMuted : theme.primary} />
    </Pressable>
  );
}

function HeroStat({
  theme,
  label,
  value,
  sub,
  tone,
}: {
  theme: Theme;
  label: string;
  value: string;
  sub?: string;
  tone?: 'up' | 'down';
}) {
  const color = tone === 'up' ? theme.up : tone === 'down' ? theme.down : theme.text;
  return (
    <View style={{ flex: 1 }}>
      <MicroLabel theme={theme}>{label}</MicroLabel>
      <Text numberOfLines={1} style={[styles.heroStatValue, numeric, { color }]}>
        {value}
      </Text>
      {sub ? (
        <Text numberOfLines={1} style={{ fontSize: 10, color: theme.textMuted, marginTop: 1, fontWeight: '600' }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, borderWidth: 1, padding: 14, gap: 14 },
  heroStats: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 13, gap: 8 },
  heroStatValue: { fontSize: 14.5, fontWeight: '800', marginTop: 3, letterSpacing: -0.2 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteBox: {
    flexDirection: 'row',
    gap: 9,
    padding: 11,
    borderRadius: radius.md,
    marginTop: 14,
    alignItems: 'flex-start',
  },
  lotsValue: { fontSize: 26, fontWeight: '800', minWidth: 42, textAlign: 'center', letterSpacing: -0.5 },
  costValue: { fontSize: 22, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  disclaimer: { fontSize: 11, textAlign: 'center', marginTop: 20, lineHeight: 16, paddingHorizontal: 10 },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
