/**
 * App root — ThemeProvider + NavigationContainer + auth gate.
 * Signed-out users see only the sign-in screen; no data loads before a session exists.
 * The build spec lives in the project docs (expo-build-spec.md); screens are
 * placeholders in this scaffold and are filled in per that spec.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme as NavTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider } from './src/components/ThemeProvider';
import { useTheme } from './src/theme';
import { AppNavigator } from './src/navigation/AppNavigator';
import { SignInScreen } from './src/screens/SignInScreen';
import { useSession } from './src/lib/auth';

function Root() {
  const { tokens, mode } = useTheme();
  const session = useSession();

  const navTheme: NavTheme = {
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: tokens.brand,
      background: tokens.bg,
      card: tokens.surface,
      text: tokens.ink,
      border: tokens.line,
      notification: tokens.danger,
    },
  };

  if (session.status === 'loading') {
    return (
      <View style={[styles.loading, { backgroundColor: tokens.bg }]}>
        <ActivityIndicator size="large" color={tokens.brand} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {session.status === 'signedIn' ? <AppNavigator /> : <SignInScreen />}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
