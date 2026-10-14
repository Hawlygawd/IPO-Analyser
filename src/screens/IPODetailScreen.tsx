import React, { useMemo } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { radius, Theme } from '../theme';
import { useStore } from '../lib/store';
import { gmpPercent, formatCr, formatDay, formatRupees, lotInvestment, subscriptionCategoryRows } from '../lib/format';
import { computeTrend, gmpSeries, insights, nextMilestone, phaseOf, sentiment } from '../lib/analysis';
import { Avatar, Button, Chip, Row, SectionCard } from '../components/ui';
import { GmpBarChart, SubscriptionBars } from '../components/Charts';
import { MilestoneTimeline } from '../components/Milestone';
import { ScreenHeader } from '../components/ScreenHeader';
import { phaseTone } from '../components/IPOCard';
import { RootStackParamList } from '../navigation/types';
import { SEBI_PUBLIC_ISSUES_URL } from '../lib/ipoSources';

export function IPODetailScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'IPODetail'>>();
  const insets = useSafeAreaInsets();
  const { isWatched, toggleWatch, permission, ipos } = useStore();

  const ipo = ipos.find((item) => item.id === route.params.id);

  const analysis = useMemo(() => {
    if (!ipo) return null;
    return {
      series: gmpSeries(ipo),
      trend: computeTrend(ipo),
      sentiment: sentiment(ipo),
      points: insights(ipo),
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
  const investment = lotInvestment(ipo);
  const s = ipo.subscription;
  const guruSource = ipo.sources?.find((source) => source.name.toLowerCase().includes('ipo guru'));
  const sourceLinks = (ipo.sources ?? []).filter((source) => source.url);
  const hasSeparatePrimaryLink = !ipo.prospectusUrl && !sourceLinks.some((source) => source.url === ipo.sourceUrl);

  const onShare = async () => {
    try {
      await Share.share({
        message: `${ipo.name} IPO (${ipo.segment})\nGMP: ${ipo.gmp != null ? `${formatRupees(ipo.gmp)} (${pct != null ? `${pct.toFixed(1)}%` : 'band TBA'})` : 'n/a'}\nOpens ${formatDay(ipo.openDate, true)} \u2022 ${ipo.exchanges.join(' & ')}\n\nShared from IPO Pulse`,
      });
    } catch {
      // user cancelled
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        title={ipo.name}
        subtitle={`${ipo.segment} \u2022 ${ipo.sector}`}
        onBack={() => navigation.goBack()}
        right={
          <Pressable
            onPress={onShare}
            style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.card, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="share-outline" size={18} color={theme.text} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 130 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Animated.View
          entering={FadeInDown.duration(320)}
          style={[styles.hero, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Row style={{ gap: 12 }}>
            <Avatar name={ipo.name} theme={theme} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: theme.text, letterSpacing: -0.3 }} numberOfLines={2}>
                {ipo.name}
              </Text>
              <Row style={{ gap: 6, marginTop: 5 }}>
                <Chip label={phase.label} tone={phaseTone(phase.key)} theme={theme} small />
                <Chip label={`${milestone.label}${milestone.tentative ? ' (est.)' : ''} ${formatDay(milestone.date)}`} tone="neutral" theme={theme} small />
              </Row>
            </View>
          </Row>

          <View style={[styles.heroStats, { borderTopColor: theme.border }]}>
            <HeroStat
              theme={theme}
              label="Price band"
              value={ipo.priceBandHigh ? `\u20B9${ipo.priceBandLow}\u2013\u20B9${ipo.priceBandHigh}` : 'TBA'}
            />
            <HeroStat theme={theme} label="Lot size" value={ipo.lotSize ? `${ipo.lotSize} sh` : 'TBA'} />
            <HeroStat theme={theme} label="Issue size" value={formatCr(ipo.issueSizeCr)} />
            <HeroStat
              theme={theme}
              label={phase.key === 'listed' ? 'Last GMP' : 'GMP'}
              value={ipo.gmp != null ? `${ipo.gmp > 0 ? '+' : ''}${formatRupees(ipo.gmp)}` : '\u2014'}
              sub={pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : 'band TBA'}
              tone={ipo.gmp == null ? 'neutral' : ipo.gmp > 0 ? 'up' : ipo.gmp < 0 ? 'down' : 'neutral'}
            />
          </View>
        </Animated.View>

        {ipo.sourceConflicts?.length ? (
          <Animated.View entering={FadeInDown.delay(35).duration(320)}>
            <SectionCard theme={theme} title="Source disagreement" style={{ marginTop: 14 }}>
              <Row style={{ alignItems: 'flex-start', gap: 8 }}>
                <Ionicons name="warning-outline" size={17} color={theme.warn} style={{ marginTop: 1 }} />
                <Text style={{ flex: 1, fontSize: 12.5, color: theme.textSub, lineHeight: 19 }}>
                  Connected sources report different issue facts. Verify the latest notice on the primary exchange before acting.
                </Text>
              </Row>
              <View style={{ marginTop: 8, gap: 6 }}>
                {ipo.sourceConflicts.map((conflict) => (
                  <Text key={conflict} style={{ fontSize: 12, color: theme.warn, lineHeight: 18 }}>• {conflict}</Text>
                ))}
              </View>
            </SectionCard>
          </Animated.View>
        ) : null}

        {/* Analysis */}
        <Animated.View entering={FadeInDown.delay(60).duration(320)}>
          <SectionCard theme={theme} title="Analysis" style={{ marginTop: 14 }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 13, color: theme.textSub, fontWeight: '600' }}>
                {phase.key === 'listed' ? 'Historical pre-listing mood' : 'Grey market mood'}
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '800',
                  color: analysis.sentiment.score >= 64 ? theme.up : analysis.sentiment.score >= 45 ? theme.warn : theme.down,
                }}
              >
                {analysis.sentiment.label}
              </Text>
            </Row>
            <View style={[styles.meterTrack, { backgroundColor: theme.neutralSoft }]}>
              <View
                style={{
                  width: `${analysis.sentiment.score}%`,
                  height: '100%',
                  borderRadius: radius.pill,
                  backgroundColor:
                    analysis.sentiment.score >= 64 ? theme.up : analysis.sentiment.score >= 45 ? theme.warn : theme.down,
                }}
              />
            </View>

            <View style={{ marginTop: 18 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: theme.textMuted, letterSpacing: 0.6, marginBottom: 10 }}>
                VERIFIED GMP HISTORY (\u20B9)
              </Text>
              {analysis.series.length > 1 ? (
                <GmpBarChart theme={theme} values={analysis.series} />
              ) : (
                <Text style={{ fontSize: 12, color: theme.textMuted, lineHeight: 18 }}>
                  {ipo.gmp == null
                    ? 'A verified grey-market quote has not been reported by the connected sources.'
                    : 'Only the latest quote is available. A trend chart is hidden until dated historical observations are supplied.'}
                </Text>
              )}
            </View>

            <View style={{ marginTop: 16, gap: 10 }}>
              {analysis.points.map((point) => (
                <Row key={point} style={{ gap: 8, alignItems: 'flex-start' }}>
                  <Ionicons name="checkmark-circle" size={15} color={theme.primary} style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, fontSize: 13, color: theme.textSub, lineHeight: 19 }}>{point}</Text>
                </Row>
              ))}
            </View>
          </SectionCard>
        </Animated.View>

        {/* Subscription */}
        <Animated.View entering={FadeInDown.delay(110).duration(320)}>
          <SectionCard
            theme={theme}
            title="Subscription by category"
            right={s?.asOf ? <Chip label={s.asOf} tone="info" theme={theme} small /> : undefined}
            style={{ marginTop: 14 }}
          >
            {subscriptionCategoryRows(s).length > 0 ? (
              <SubscriptionBars
                theme={theme}
                rows={subscriptionCategoryRows(s).map((row) => ({
                  label: row.label,
                  value: row.value,
                  display: `${row.value.toFixed(2)}x`,
                  tone: row.key === 'qib' ? 'info' : row.key === 'employee' || row.key === 'shareholder' ? 'warn' : 'up',
                }))}
              />
            ) : s?.total != null ? (
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 12.5, color: theme.textSub, lineHeight: 18 }}>
                  Category-wise figures have not been supplied by the connected source.
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: theme.text }}>
                  Overall only: {s.total.toFixed(2)}x
                </Text>
                <Text style={{ fontSize: 11.5, color: theme.textMuted, lineHeight: 17 }}>
                  Category figures appear only when NSE/BSE or a configured IPO Guru Standard-or-higher account supplies them; availability varies by issue and refresh time.
                </Text>
              </View>
            ) : (
              <Text style={{ fontSize: 13, color: theme.textSub, lineHeight: 20 }}>
                No subscription figures have been reported yet. Each category is shown separately once a connected source publishes it.
              </Text>
            )}
            {guruSource ? (
              <Pressable onPress={() => Linking.openURL(guruSource.url ?? 'https://www.ipoguru.in/').catch(() => undefined)} hitSlop={8}>
                <Text style={{ color: theme.primary, fontSize: 11.5, fontWeight: '700', textDecorationLine: 'underline', marginTop: 8 }}>
                  Data by IPO Guru
                </Text>
              </Pressable>
            ) : null}
          </SectionCard>
        </Animated.View>

        {/* Timeline */}
        <Animated.View entering={FadeInDown.delay(160).duration(320)}>
          <SectionCard theme={theme} title="IPO timeline" style={{ marginTop: 14 }}>
            <MilestoneTimeline ipo={ipo} theme={theme} />
          </SectionCard>
        </Animated.View>

        {/* About */}
        <Animated.View entering={FadeInDown.delay(210).duration(320)}>
          <SectionCard theme={theme} title="About the issue" style={{ marginTop: 14 }}>
            <Text style={{ fontSize: 13.5, color: theme.textSub, lineHeight: 20.5 }}>{ipo.about}</Text>

            <View style={styles.factGrid}>
              <Fact label="Issue type" value={ipo.issueType ?? 'TBA'} theme={theme} />
              <Fact label="Listing on" value={ipo.exchanges.join(' & ')} theme={theme} />
              <Fact label="Min. investment" value={investment != null ? formatRupees(Math.round(investment)) : 'TBA'} theme={theme} />
              <Fact label="Sector" value={ipo.sector} theme={theme} />
            </View>

            <View style={{ gap: 8, marginTop: 14 }}>
              {ipo.prospectusUrl ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(ipo.prospectusUrl ?? '').catch(() => undefined)}
                  style={({ pressed }) => [
                    styles.sourceRow,
                    { marginTop: 0, backgroundColor: theme.cardAlt, borderColor: theme.border },
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Ionicons name="document-text-outline" size={17} color={theme.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: theme.text }}>Issuer prospectus / RHP</Text>
                    <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 1 }} numberOfLines={1}>{ipo.prospectusUrl}</Text>
                  </View>
                  <Ionicons name="open-outline" size={15} color={theme.textMuted} />
                </Pressable>
              ) : null}
              {hasSeparatePrimaryLink ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(ipo.sourceUrl).catch(() => undefined)}
                  style={({ pressed }) => [
                    styles.sourceRow,
                    { marginTop: 0, backgroundColor: theme.cardAlt, borderColor: theme.border },
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Ionicons name="document-text-outline" size={17} color={theme.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: theme.text }}>Primary issue link</Text>
                    <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 1 }}>Issuer / prospectus / provider record</Text>
                  </View>
                  <Ionicons name="open-outline" size={15} color={theme.textMuted} />
                </Pressable>
              ) : null}
              {sourceLinks.map((source) => (
                <Pressable
                  key={`${source.name}-${source.url}`}
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(source.url ?? ipo.sourceUrl).catch(() => undefined)}
                  style={({ pressed }) => [
                    styles.sourceRow,
                    { marginTop: 0, backgroundColor: theme.cardAlt, borderColor: theme.border },
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Ionicons name="open-outline" size={17} color={theme.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: theme.text }}>{source.name}</Text>
                    <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 1 }} numberOfLines={1}>{source.url}</Text>
                  </View>
                  <Ionicons name="open-outline" size={15} color={theme.textMuted} />
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="link"
                onPress={() => Linking.openURL(SEBI_PUBLIC_ISSUES_URL).catch(() => undefined)}
                style={({ pressed }) => [
                  styles.sourceRow,
                  { marginTop: 0, backgroundColor: theme.cardAlt, borderColor: theme.border },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Ionicons name="document-text-outline" size={17} color={theme.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: theme.text }}>SEBI public-issue filings</Text>
                  <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 1 }}>Official offer-document index; not live subscription data</Text>
                </View>
                <Ionicons name="open-outline" size={15} color={theme.textMuted} />
              </Pressable>
            </View>
          </SectionCard>
        </Animated.View>

        <Text style={[styles.disclaimer, { color: theme.textMuted }]}>
          Data is indicative and sourced from public trackers. Grey market premiums are unofficial and
          subject to change. This is not investment advice.
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
          label={watched ? 'Watching \u2022 reminders on' : 'Add to watchlist'}
          icon={watched ? 'notifications' : 'add'}
          variant={watched ? 'soft' : 'primary'}
          onPress={() => toggleWatch(ipo)}
          style={{ flex: 1 }}
        />
        {!watched && permission !== 'granted' ? (
          <Pressable onPress={() => navigation.navigate('Alerts')} style={{ paddingHorizontal: 4 }}>
            <Ionicons name="notifications-off-outline" size={20} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
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
  tone?: 'up' | 'down' | 'neutral';
}) {
  const color = tone === 'up' ? theme.up : tone === 'down' ? theme.down : theme.text;
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, color: theme.textMuted, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '800', color, marginTop: 3, letterSpacing: -0.2 }}>
        {value}
      </Text>
      {sub ? <Text style={{ fontSize: 10, color: theme.textMuted, marginTop: 1 }}>{sub}</Text> : null}
    </View>
  );
}

function Fact({ theme, label, value }: { theme: Theme; label: string; value: string }) {
  return (
    <View style={{ width: '50%', paddingVertical: 7 }}>
      <Text style={{ fontSize: 10.5, fontWeight: '700', color: theme.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text numberOfLines={2} style={{ fontSize: 13, fontWeight: '700', color: theme.text, marginTop: 3 }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, borderWidth: 1, padding: 14, gap: 14 },
  heroStats: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 13, gap: 8 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meterTrack: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: 14,
  },
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
