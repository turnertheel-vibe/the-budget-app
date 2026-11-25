/** Shared placeholder UI for scaffold screens. The screens agent replaces each placeholder with the real screen (see expo-build-spec.md). */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export function PlaceholderScreen({
  title,
  subtitle,
  bullets,
}: {
  title: string;
  subtitle: string;
  bullets: string[];
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <Text style={[styles.title, { color: tokens.ink }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: tokens.ink2 }]}>{subtitle}</Text>
      <View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.line }]}>
        {bullets.map((b) => (
          <Text key={b} style={[styles.bullet, { color: tokens.ink2 }]}>
            {'•  '}
            {b}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bullet: { fontSize: 14, lineHeight: 22 },
  card: { borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 16 },
  container: { flex: 1, padding: 20 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
});
