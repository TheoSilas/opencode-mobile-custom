import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Colors } from '@/constants/theme';

type Palette = typeof Colors.light;

export function NumericSlider({
  label,
  maximum,
  minimum,
  onValueChange,
  palette,
  step,
  value,
  valueLabel,
}: {
  label: string;
  maximum: number;
  minimum: number;
  onValueChange: (value: number) => void;
  palette: Palette;
  step: number;
  value: number;
  valueLabel: string;
}) {
  const [width, setWidth] = useState(0);
  const percentage = ((value - minimum) / (maximum - minimum)) * 100;

  function setFromPosition(position: number) {
    if (!width) return;
    const raw = minimum + Math.max(0, Math.min(1, position / width)) * (maximum - minimum);
    onValueChange(Number((Math.round(raw / step) * step).toFixed(2)));
  }

  function adjust(key: string) {
    if (key === 'Home') onValueChange(minimum);
    else if (key === 'End') onValueChange(maximum);
    else if (['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'].includes(key)) {
      onValueChange(Number(Math.max(minimum, Math.min(maximum, value + (['ArrowRight', 'ArrowUp'].includes(key) ? step : -step))).toFixed(2)));
    } else return false;
    return true;
  }

  return (
    <View style={styles.numericSlider}>
      <View style={styles.numericSliderHeader}>
        <Text style={{ color: palette.text }}>{label}</Text>
        <Text style={{ color: palette.muted }}>{valueLabel}</Text>
      </View>
      <View
        accessible
        tabIndex={0}
        {...(Platform.OS === 'web' ? { role: 'slider' as const, onKeyDown: (event: KeyboardEvent) => { if (adjust(event.key)) event.preventDefault(); } } : {})}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const action = event.nativeEvent.actionName;
          if (action === 'increment' || action === 'decrement') {
            onValueChange(Math.max(minimum, Math.min(maximum, value + (action === 'increment' ? step : -step))));
          }
        }}
        aria-valuemin={minimum}
        aria-valuemax={maximum}
        aria-valuenow={value}
        aria-valuetext={valueLabel}
        accessibilityLabel={label}
        accessibilityRole="adjustable"
        accessibilityValue={{ max: maximum, min: minimum, now: value, text: valueLabel }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onResponderGrant={(event) => setFromPosition(event.nativeEvent.locationX)}
        onResponderMove={(event) => setFromPosition(event.nativeEvent.locationX)}
        onStartShouldSetResponder={() => true}
        style={styles.sliderTouchTarget}
      >
        <View pointerEvents="none" style={[styles.sliderTrack, { backgroundColor: palette.border }]}>
          <View style={[styles.sliderProgress, { backgroundColor: palette.tint, width: `${percentage}%` }]} />
          <View style={[styles.sliderThumb, { backgroundColor: palette.tint, left: `${percentage}%` }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  numericSlider: { gap: 8 },
  numericSliderHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  sliderTouchTarget: { height: 44, justifyContent: 'center', marginHorizontal: 12 },
  sliderTrack: { borderRadius: 999, height: 6, justifyContent: 'center' },
  sliderProgress: { borderRadius: 999, height: 6 },
  sliderThumb: { borderRadius: 12, height: 24, marginLeft: -12, position: 'absolute', width: 24 },
});
