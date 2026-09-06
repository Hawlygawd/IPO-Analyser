import { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  IPOs: undefined;
  Watchlist: undefined;
  GMP: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  IPODetail: { id: string };
  Alerts: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
