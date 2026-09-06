import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
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

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

/** Binds the shared theme to a screen without prop-drilling through navigation. */
function withTheme<P extends object>(Screen: React.ComponentType<P & { theme: Theme }>) {
  return function ThemedScreen(props: P) {
    const { theme } = useStore();
    return <Screen {...props} theme={theme} />;
  };
}

const TAB_ICONS: Record<keyof TabParamList, { focus: keyof typeof Ionicons.glyphMap; blur: keyof typeof Ionicons.glyphMap }> = {
  IPOs: { focus: 'trending-up', blur: 'trending-up-outline' },
  Watchlist: { focus: 'star', blur: 'star-outline' },
  GMP: { focus: 'stats-chart', blur: 'stats-chart-outline' },
  Settings: { focus: 'settings', blur: 'settings-outline' },
};

function Tabs() {
  const { theme, watchlist } = useStore();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '700', marginTop: -2 },
        tabBarIcon: ({ color, focused }) => {
          const icons = TAB_ICONS[route.name as keyof TabParamList];
          return <Ionicons name={focused ? icons.focus : icons.blur} size={21} color={color} />;
        },
      })}
    >
      <Tab.Screen name="IPOs" component={withTheme(HomeScreen)} />
      <Tab.Screen
        name="Watchlist"
        component={withTheme(WatchlistScreen)}
        options={{ tabBarBadge: watchlist.length > 0 ? watchlist.length : undefined, tabBarBadgeStyle: { backgroundColor: theme.warn, color: '#fff', fontSize: 10.5, fontWeight: '800' } }}
      />
      <Tab.Screen name="GMP" component={withTheme(GmpBoardScreen)} />
      <Tab.Screen name="Settings" component={withTheme(SettingsScreen)} />
    </Tab.Navigator>
  );
}

function Root() {
  const { theme } = useStore();

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

  return (
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
  );
}

function Boot() {
  const { ready, theme } = useStore();
  if (!ready) {
    return (
      <View style={[styles.boot, { backgroundColor: theme.bg }]}>
        <View style={[styles.bootLogo, { backgroundColor: theme.primary }]}>
          <Ionicons name="trending-up" size={26} color="#fff" />
        </View>
        <Text style={[styles.bootText, { color: theme.text }]}>IPO Pulse</Text>
      </View>
    );
  }
  return <Root />;
}

export default function App() {
  const [fontsLoaded] = useFonts({ ...Ionicons.font });
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StoreProvider>
          <Boot />
        </StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  bootLogo: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  bootText: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
});
