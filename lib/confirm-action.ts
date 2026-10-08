import { Alert, Platform } from 'react-native';

export function confirmAction(title: string, message: string, action: string, cancel: string, run: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm(`${title}\n\n${message}`)) run();
  } else {
    Alert.alert(title, message, [{ text: cancel, style: 'cancel' }, { text: action, style: 'destructive', onPress: run }]);
  }
}
