import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DarkTheme as NavDark,
  DefaultTheme as NavLight,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StoreProvider, useStore } from './src/lib/store';
import { Theme } from './src/theme';
import { HomeScreen } from './src/screens/HomeScreen';
import { IPODetailScreen } from './src/screens/IPODetailScreen';
import { WatchlistScreen } from './src/screens/WatchlistScreen';
import { GmpBoardScreen } from './src/screens/GmpBoardScreen';
import { AlertsScreen } from './src/screens/AlertsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { RootStackParamList, TabParamList } from './src/navigation/types';
import { setupNotificationChannel } from './src/lib/notifications';
import { ToastHost } from './src/components/ui';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

/** Binds the shared theme to a screen without prop-drilling through navigation. */
function withTheme<P extends object>(Screen: React.ComponentType<P & { theme: Theme }>) {
  return function ThemedScreen(props: P) {
    const { theme } = useStore();
    return <Screen {...props} theme={theme} />;
  };
}

const TAB_ICONS: Record<
  keyof TabParamList,
  { focus: keyof typeof Ionicons.glyphMap; blur: keyof typeof Ionicons.glyphMap; label: string }
> = {
  IPOs: { focus: 'trending-up', blur: 'trending-up-outline', label: 'IPOs' },
  Watchlist: { focus: 'star', blur: 'star-outline', label: 'Watchlist' },
  GMP: { focus: 'stats-chart', blur: 'stats-chart-outline', label: 'GMP board' },
  Settings: { focus: 'settings', blur: 'settings-outline', label: 'Settings' },
};

function Tabs() {
  const { theme, watchlist } = useStore();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const meta = TAB_ICONS[route.name as keyof TabParamList];
        return {
          headerShown: false,
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textMuted,
          tabBarHideOnKeyboard: true,
          tabBarAccessibilityLabel: meta.label,
          tabBarStyle: {
            backgroundColor: theme.card,
            borderTopColor: theme.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            height: Platform.OS === 'ios' ? 82 : 62,
            paddingTop: 6,
            paddingBottom: Platform.OS === 'ios' ? 22 : 6,
          },
          tabBarLabelStyle: { fontSize: 10.5, fontWeight: '700' },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? meta.focus : meta.blur} size={21} color={color} />
          ),
        };
      }}
    >
      <Tab.Screen name="IPOs" component={withTheme(HomeScreen)} />
      <Tab.Screen
        name="Watchlist"
        component={withTheme(WatchlistScreen)}
        options={{
          tabBarBadge: watchlist.length > 0 ? watchlist.length : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.warn,
            color: '#fff',
            fontSize: 10.5,
            fontWeight: '800',
          },
        }}
      />
      <Tab.Screen name="GMP" component={withTheme(GmpBoardScreen)} />
      <Tab.Screen name="Settings" component={withTheme(SettingsScreen)} />
    </Tab.Navigator>
  );
}

/** Keeps a crash from leaving the user on a blank screen. */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; theme: Theme },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('IPO Pulse crashed:', error);
  }

  render() {
    const { theme, children } = this.props;
    if (!this.state.error) return children;
    return (
      <View style={[styles.fallback, { backgroundColor: theme.bg }]}>
        <Ionicons name="warning-outline" size={34} color={theme.warn} />
        <Text style={[styles.fallbackTitle, { color: theme.text }]}>Something went wrong</Text>
        <Text style={[styles.fallbackBody, { color: theme.textSub }]}>
          The screen failed to render. Your watchlist and settings are stored on this device and are safe.
        </Text>
        <Pressable
          onPress={() => this.setState({ error: null })}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={[styles.fallbackBtn, { backgroundColor: theme.primary }]}
        >
          <Text style={{ color: theme.onPrimary, fontWeight: '800', fontSize: 14 }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

function Root() {
  const { theme, toast, dismissToast } = useStore();

  React.useEffect(() => {
    setupNotificationChannel();
  }, []);

  const navTheme = {
    ...(theme.mode === 'dark' ? NavDark : NavLight),
    colors: {
      ...(theme.mode === 'dark' ? NavDark.colors : NavLight.colors),
      background: theme.bg,
      card: theme.card,
      text: theme.text,
      primary: theme.primary,
      border: theme.border,
    },
  };

  const shell = (
    <>
      <NavigationContainer theme={navTheme}>
        <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="IPODetail" component={withTheme(IPODetailScreen)} />
          <Stack.Screen
            name="Alerts"
            component={withTheme(AlertsScreen)}
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      {toast ? (
        <ToastHost message={toast.message} tone={toast.tone} theme={theme} onDismiss={dismissToast} />
      ) : null}
    </>
  );

  // On the web the app is a phone-shaped surface: centre it instead of stretching
  // mobile-sized rows across a desktop viewport.
  if (Platform.OS !== 'web') {
    return <View style={{ flex: 1, backgroundColor: theme.bg }}>{shell}</View>;
  }

  return (
    <View style={[styles.webOuter, { backgroundColor: theme.mode === 'dark' ? '#05070A' : '#E9EDF3' }]}>
      <View
        style={[
          styles.webShell,
          {
            backgroundColor: theme.bg,
            borderColor: theme.border,
            boxShadow: theme.mode === 'dark' ? '0 0 60px rgba(0,0,0,0.6)' : '0 0 60px rgba(11,27,51,0.12)',
          } as any,
        ]}
      >
        {shell}
      </View>
    </View>
  );
}

/**
 * The icon font is a nice-to-have: if it stalls (slow network, blocked CDN, unusual
 * runtime) the app must still render rather than sit on the splash screen forever.
 */
function useIconFontReady(timeoutMs = 2500): boolean {
  const [loaded, error] = useFonts({ ...Ionicons.font });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs]);

  return loaded || Boolean(error) || timedOut;
}

function Boot() {
  const { ready, theme } = useStore();
  const iconsReady = useIconFontReady();

  if (!iconsReady || !ready) {
    return (
      <View style={[styles.boot, { backgroundColor: theme.bg }]}>
        <View style={[styles.bootLogo, { backgroundColor: theme.primary }]}>
          <Ionicons name="trending-up" size={26} color="#fff" />
        </View>
        <Text style={[styles.bootText, { color: theme.text }]}>IPO Pulse</Text>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>Loading the board…</Text>
      </View>
    );
  }
  return <Root />;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StoreProvider>
          <ThemedBoundary />
        </StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedBoundary() {
  const { theme } = useStore();
  return (
    <ErrorBoundary theme={theme}>
      <Boot />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  webOuter: { flex: 1, alignItems: 'center' },
  webShell: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
    overflow: 'hidden',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  bootLogo: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  bootText: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  fallbackTitle: { fontSize: 18, fontWeight: '800', marginTop: 6 },
  fallbackBody: { fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
  fallbackBtn: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    minHeight: 44,
    justifyContent: 'center',
  },
});
