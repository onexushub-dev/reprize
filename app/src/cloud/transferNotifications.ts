import { AppState, PermissionsAndroid, Platform } from 'react-native';

/**
 * On Android 13+, the clip transfers' foreground service shows its "Reprize: enviando clipes" notification only once
 * the app holds POST_NOTIFICATIONS. Asks for it when a transfer starts with the app in front (the person just tapped
 * share or opened a link). Never blocks or fails the transfer: refused, it goes on without the notification.
 */
export async function askTransferNotifications(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  if (AppState.currentState !== 'active') return;
  try {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (await PermissionsAndroid.check(permission)) return;
    await PermissionsAndroid.request(permission);
  } catch {
    // No activity to ask from: the transfer runs without a notification.
  }
}
