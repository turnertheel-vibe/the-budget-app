/**
 * Shared screen UI — cards, bars, controls. All colors come from the theme
 * tokens; nothing here hardcodes a household, label, or dollar amount.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.line }, style]}>
      {children}
    </View>
  );
}

export function CardTitle({ title, right }: { title: string; right?: string }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.cardTitle}>
      <Text style={[styles.cardTitleText, { color: tokens.ink }]}>{title}</Text>
      {right ? <Text style={{ color: tokens.ink2, fontSize: 13, fontWeight: '700' }}>{right}</Text> : null}
    </View>
  );
}

export function SectionTitle({ title }: { title: string }) {
  const { tokens } = useTheme();
  return <Text style={[styles.sectionTitle, { color: tokens.ink2 }]}>{title}</Text>;
}

/** Thin progress bar (0–1 fill), with an optional pace tick at `pace` (0–1). */
export function Bar({
  fill,
  color,
  pace,
  height = 8,
}: {
  fill: number;
  color: string;
  pace?: number;
  height?: number;
}) {
  const { tokens } = useTheme();
  const clamped = Math.max(0, Math.min(1, fill));
  return (
    <View style={[styles.barTrack, { backgroundColor: tokens.surface2, height }]}>
      <View style={{ width: `${clamped * 100}%`, height: '100%', backgroundColor: color, borderRadius: 99 }} />
      {pace !== undefined && pace >= 0 && pace <= 1 ? (
        <View style={[styles.paceTick, { left: `${pace * 100}%`, backgroundColor: tokens.ink }]} />
      ) : null}
    </View>
  );
}

/** Stacked Needs / Wants / Savings / Unallocated bar. Segments: {value, color}. */
export function SplitBar({ segments }: { segments: { value: number; color: string }[] }) {
  const { tokens } = useTheme();
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <View style={[styles.barTrack, { backgroundColor: tokens.surface2, height: 12 }]}>
      {total > 0
        ? segments
            .filter((s) => s.value > 0)
            .map((s, i) => (
              <View
                key={i}
                style={{ width: `${(s.value / total) * 100}%`, height: '100%', backgroundColor: s.color }}
              />
            ))
        : null}
      {total < 100 ? (
        <View style={{ width: `${100 - total}%`, height: '100%', backgroundColor: tokens.unallocated }} />
      ) : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { tokens } = useTheme();
  const bg = disabled ? tokens.unallocated : danger ? tokens.danger : tokens.brand;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.primaryButton, { backgroundColor: bg }]}
    >
      <Text style={[styles.primaryButtonText, { color: tokens.brandInk }]}>{label}</Text>
    </Pressable>
  );
}

export function SegControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: tokens.surface2 }]}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={[styles.segButton, value === o && { backgroundColor: tokens.surface }]}
        >
          <Text style={{ color: value === o ? tokens.ink : tokens.ink2, fontWeight: '600', fontSize: 13 }}>
            {o}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function RowButton({
  title,
  subtitle,
  right,
  onPress,
  danger,
}: {
  title: string;
  subtitle?: string;
  right?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.rowButton}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, { color: danger ? tokens.danger : tokens.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? (
        <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600', marginLeft: 8 }}>{right}</Text>
      ) : null}
      {onPress ? <Text style={{ color: tokens.ink3, fontSize: 16, marginLeft: 6 }}>›</Text> : null}
    </Pressable>
  );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={tokens.brand} />
      <Text style={{ color: tokens.ink2, marginTop: 12 }}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: tokens.ink }]}>{title}</Text>
      {body ? <Text style={{ color: tokens.ink2, fontSize: 13.5, lineHeight: 19, marginTop: 6 }}>{body}</Text> : null}
    </View>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  const { tokens } = useTheme();
  if (!message) return null;
  return <Text style={{ color: tokens.danger, fontSize: 13.5, lineHeight: 19, marginTop: 8 }}>{message}</Text>;
}

const styles = StyleSheet.create({
  barTrack: { borderRadius: 99, flexDirection: 'row', overflow: 'hidden', position: 'relative' },
  card: { borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 16 },
  cardTitle: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cardTitleText: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  empty: { alignItems: 'center', paddingVertical: 20 },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  paceTick: { bottom: -3, position: 'absolute', top: -3, width: 2.5, borderRadius: 2, opacity: 0.55 },
  primaryButton: { alignItems: 'center', borderRadius: 12, marginTop: 14, paddingVertical: 13 },
  primaryButtonText: { fontSize: 15, fontWeight: '700' },
  rowButton: { alignItems: 'center', flexDirection: 'row', paddingVertical: 10 },
  rowTitle: { fontSize: 14.5, fontWeight: '600' },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginTop: 20, textTransform: 'uppercase' },
  seg: { borderRadius: 10, flexDirection: 'row', padding: 3 },
  segButton: { alignItems: 'center', borderRadius: 8, flex: 1, paddingHorizontal: 14, paddingVertical: 8 },
});
