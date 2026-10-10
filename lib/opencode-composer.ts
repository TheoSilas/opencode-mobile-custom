import { requireNativeModule, requireNativeView } from 'expo';
import { Platform, type ViewProps } from 'react-native';

export type PickedImage = { uri: string; mimeType: string; name?: string; size?: number };

type OpencodeComposerModule = {
  pickImages: (multiple: boolean) => Promise<PickedImage[]>;
};

export type ComposerImageInputProps = ViewProps & {
  supportsImageInsertion?: boolean;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
  editable?: boolean;
  fontSize?: number;
  textColor?: string;
  onImageInsert?: (event: { nativeEvent: { uri: string; mimeType: string; error?: string } }) => void;
  onChangeText?: (event: { nativeEvent: { text: string } }) => void;
  onContentSizeChange?: (event: { nativeEvent: { width: number; height: number } }) => void;
};

const composerModule =
  Platform.OS === 'android' ? requireNativeModule<OpencodeComposerModule>('OpencodeComposer') : undefined;

/** Opens the system photo browser (Photo Picker, or the gallery app as fallback). */
export async function pickImages(multiple = true): Promise<PickedImage[]> {
  if (!composerModule) return [];
  return composerModule.pickImages(multiple);
}

export const ComposerImageInput =
  Platform.OS === 'android' ? requireNativeView<ComposerImageInputProps>('OpencodeComposer') : undefined;
