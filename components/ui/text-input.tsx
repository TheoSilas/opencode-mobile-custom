import type { ComponentProps } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { TextInput as PaperTextInput, useTheme } from 'react-native-paper';

type PaperTextInputProps = ComponentProps<typeof PaperTextInput>;

export function TextInput({ cursorColor, selectionColor, contentStyle, ...rest }: PaperTextInputProps) {
  const { colors } = useTheme();
  const clearAlignment = Platform.OS === 'ios' && !rest.multiline
    && StyleSheet.flatten(rest.style)?.textAlign === undefined;
  return (
    <PaperTextInput
      cursorColor={cursorColor ?? colors.primary}
      selectionColor={selectionColor ?? colors.primary}
      // Paper's default alignment can wrap single-line UIKit inputs (#4792).
      contentStyle={clearAlignment ? [{ textAlign: undefined }, contentStyle] : contentStyle}
      {...rest}
    />
  );
}
