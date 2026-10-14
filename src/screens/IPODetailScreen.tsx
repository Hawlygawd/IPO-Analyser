import React, { useMemo } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { radius, Theme } from '../theme';
import { useStore } from '../lib/store';
import { getIpo } from '../lib/ipoData';
import { gmpPercent, formatCr, formatDay, formatRupees, lotInvestment } from '../lib/format';
import { computeTrend, gmpSeries, insights, nextMilestone, phaseOf, sentiment } from '../lib/analysis';
import { Avatar, Button, Chip, Row, SectionCard } from '../components/ui';
import { GmpBarChart, SubscriptionBars } from '../components/Charts';
import { MilestoneTimeline } from '../components/Milestone';
import { ScreenHeader } from '../components/ScreenHeader';
import { phaseTone } from '../components/IPOCard';
import { RootStackParamList } from '../navigation/types';

export function IPODetailScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'IPODetail'>>();
  const insets = useSafeAreaInsets();
  const { isWatched, toggleWatch, permission } = useStore();

  const ipo = getIpo(route.params.id);

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
                <Chip label={`${milestone.label} ${formatDay(milestone.date)}`} tone="neutral" theme={theme} small />
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
              label="GMP"
              value={ipo.gmp != null ? `${ipo.gmp > 0 ? '+' : ''}${formatRupees(ipo.gmp)}` : '\u2014'}
              sub={pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : 'band TBA'}
              tone={ipo.gmp == null ? 'neutral' : ipo.gmp > 0 ? 'up' : ipo.gmp < 0 ? 'down' : 'neutral'}
            />
          </View>
        </Animated.View>

        {/* Analysis */}
        <Animated.View entering={FadeInDown.delay(60).duration(320)}>
          <SectionCard theme={theme} title="Analysis" style={{ marginTop: 14 }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 13, color: theme.textSub, fontWeight: '600' }}>Grey market mood</Text>
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
                GMP \u2022 LAST 7 SESSIONS (\u20B9)
              </Text>
              <GmpBarChart
                theme={theme}
                values={analysis.series}
                labels={[formatDay(ipo.openDate), 'Today']}
              />
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
        {s ? (
          <Animated.View entering={FadeInDown.delay(110).duration(320)}>
            <SectionCard
              theme={theme}
              title="Subscription"
              right={<Chip label={s.asOf ?? 'Final'} tone="info" theme={theme} small />}
              style={{ marginTop: 14 }}
            >
              <SubscriptionBars
                theme={theme}
                rows={[
                  s.qib != null ? { label: 'QIB', value: s.qib, display: `${s.qib.toFixed(2)}x`, tone: 'info' as const } : null,
                  s.nii != null ? { label: 'NII / HNI', value: s.nii, display: `${s.nii.toFixed(2)}x`, tone: 'up' as const } : null,
                  s.retail != null ? { label: 'Retail', value: s.retail, display: `${s.retail.toFixed(2)}x`, tone: 'up' as const } : null,
                  s.total != null ? { label: 'Overall', value: s.total, display: `${s.total.toFixed(2)}x`, tone: 'warn' as const } : null,
                ].filter((r): r is NonNullable<typeof r> => r != null)}
              />
            </SectionCard>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.delay(110).duration(320)}>
            <SectionCard theme={theme} title="Subscription" style={{ marginTop: 14 }}>
              <Text style={{ fontSize: 13, color: theme.textSub, lineHeight: 20 }}>
                Bidding has not started yet. Category-wise subscription updates appear here from the opening day.
              </Text>
            </SectionCard>
          </Animated.View>
        )}

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

            <Pressable
              onPress={() => Linking.openURL(ipo.sourceUrl).catch(() => undefined)}
              style={({ pressed }) => [
                styles.sourceRow,
                { backgroundColor: theme.cardAlt, borderColor: theme.border },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Ionicons name="document-text-outline" size={17} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: theme.text }}>RHP, dates & live updates</Text>
                <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 1 }}>via {ipo.sourceName}</Text>
              </View>
              <Ionicons name="open-outline" size={15} color={theme.textMuted} />
            </Pressable>
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
