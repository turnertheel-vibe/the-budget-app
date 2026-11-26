/**
 * Navigation shell — React Navigation bottom tabs in prototype order:
 * Home · Activity · Plan · (+) · Savings · Year · Settings.
 * The center (+) is not a tab: it opens the Add Transaction sheet (modal).
 * Stack screens (Labels, Accounts, Reimbursement Log) sit above the tabs.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../theme';
import { HomeScreen } from '../screens/HomeScreen';
import { ActivityScreen } from '../screens/ActivityScreen';
import { PlanScreen } from '../screens/PlanScreen';
import { SavingsScreen } from '../screens/SavingsScreen';
import { YearScreen } from '../screens/YearScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { LabelsScreen } from '../screens/LabelsScreen';
import { AccountsScreen } from '../screens/AccountsScreen';
import { ReimbursementLogScreen } from '../screens/ReimbursementLogScreen';
import { AddTransactionScreen } from '../screens/AddTransactionScreen';

export type TabParamList = {
  Home: undefined;
  Activity: undefined;
  Plan: undefined;
  Add: undefined;
  Savings: undefined;
  Year: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Main: undefined;
  /**
   * Opened from a parked (open) charge, the Add sheet is pre-filled from it
   * and saving applies the row against the parked charge (see
   * AddTransactionScreen). All fields optional; plain Add passes nothing.
   */
  AddTransaction:
    | { openItemId?: string; openItemDescription?: string; openItemAmountCents?: number; openItemDate?: string }
    | undefined;
  Labels: undefined;
  Accounts: undefined;
  ReimbursementLog: undefined;
};

export type RootStackNavigation = NativeStackNavigationProp<RootStackParamList>;

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

/** Round center + button. Tapping opens the Add Transaction modal instead of a tab. */
function AddTabButton(props: BottomTabBarButtonProps) {
  const { tokens } = useTheme();
  const navigation = useNavigation<RootStackNavigation>();
  return (
    <View style={styles.addWrap}>
      <Pressable
        {...props}
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        onPress={() => navigation.navigate('AddTransaction')}
        style={[styles.addButton, { backgroundColor: tokens.brand }]}
      >
        <Ionicons name="add" size={28} color={tokens.brandInk} />
      </Pressable>
    </View>
  );
}

function MainTabs() {
  const { tokens } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.brand,
        tabBarInactiveTintColor: tokens.ink2,
        tabBarStyle: { backgroundColor: tokens.tabBarBg, borderTopColor: tokens.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }}
      />
      <Tab.Screen
        name="Activity"
        component={ActivityScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color} /> }}
      />
      <Tab.Screen
        name="Plan"
        component={PlanScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="options-outline" size={size} color={color} /> }}
      />
      <Tab.Screen
        name="Add"
        component={HomeScreen}
        options={{ tabBarLabel: '', tabBarButton: (props) => <AddTabButton {...props} /> }}
      />
      <Tab.Screen
        name="Savings"
        component={SavingsScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" size={size} color={color} /> }}
      />
      <Tab.Screen
        name="Year"
        component={YearScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} /> }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} /> }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { tokens } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: tokens.surface },
        headerTintColor: tokens.ink,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: tokens.bg },
      }}
    >
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="AddTransaction"
        component={AddTransactionScreen}
        options={{ presentation: 'modal', title: 'Add transaction' }}
      />
      <Stack.Screen name="Labels" component={LabelsScreen} options={{ title: 'Chart of accounts' }} />
      <Stack.Screen name="Accounts" component={AccountsScreen} options={{ title: 'Accounts & statement names' }} />
      <Stack.Screen
        name="ReimbursementLog"
        component={ReimbursementLogScreen}
        options={{ title: 'Reimbursement Log' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  addWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-start',
    marginTop: -18,
  },
});
