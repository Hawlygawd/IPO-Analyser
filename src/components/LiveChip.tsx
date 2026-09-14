import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, Theme } from '../theme';
import type { LiveInfo } from '../lib/store';

/**
 * One glanceable answer to "where did these numbers come from?".
 *
 * Green means the last pull reached the upstream boards and shows the upstream stamp
 * ("Live • 5:30 PM"), blue means the boards could not be read and the figures came from the
 * AI assist's web search instead, amber means the app is running on what it already had.
 * The chip doubles as the manual refresh button when a pull fails.
 */
export function LiveChip({
  theme,
  live,
  asOfLabel,
  onPress,
}: {
  theme: Theme;
  live: LiveInfo;
  /** the label of the data currently on screen */
  asOfLabel: string;
  onPress?: () => void;
}) {
  const loading = live.state === 'loading';
  const isAi = live.state === 'ai' && live.fetchedAt !== null;
  const isLive = live.state === 'live' && live.fetchedAt !== null;
  const time = asOfLabel.split(', ').pop() ?? asOfLabel;

  const tone = loading ? theme.info : isAi ? theme.info : isLive ? theme.up : theme.warn;
  const soft = loading ? theme.infoSoft : isAi ? theme.infoSoft : isLive ? theme.upSoft : theme.warnSoft;
  const label = loading ? 'Updating…' : isAi ? `AI • ${time}` : isLive ? `Live • ${time}` : 'Snapshot';
  const icon = loading ? 'sync-outline' : isAi ? 'sparkles-outline' : isLive ? 'pulse-outline' : 'cloud-offline-outline';
  const aiWho = live.ai ? `${live.ai.providerLabel} • ${live.ai.model}` : 'your saved key';
  const detail = loading
    ? 'Fetching the latest boards from IPO Ji'
    : isAi
      ? `Figures from an AI web search (${aiWho}), newest reported stamp ${asOfLabel}${
          live.updated > 0 ? `, ${live.updated} figures updated` : ''
        }`
      : isLive
        ? `Live from IPO Ji, newest upstream stamp ${asOfLabel}${
            live.updated > 0 ? `, ${live.updated} figures updated` : ''
          }${live.ai?.used ? `, some figures filled by ${live.ai.providerLabel}` : ''}`
        : live.error
          ? `Live boards unreachable (${live.error}) - showing the saved snapshot of ${asOfLabel}`
          : `Bundled snapshot of ${asOfLabel}`;

  const body = (
    <View
      accessibilityRole="text"
      accessibilityLabel={detail}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: soft,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: radius.pill,
        alignSelf: 'flex-start',
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: tone,
          opacity: isLive || isAi ? 1 : 0.7,
        }}
      />
      <Ionicons name={icon} size={11} color={tone} />
      <Text style={{ color: tone, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.2 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${detail}. Tap to refresh now.`}
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
    >
      {body}
    </Pressable>
  );
}
