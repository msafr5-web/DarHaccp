import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Registers the device for HACCP alert push notifications (CCP deviations, expiring
 * health certificates, overdue maintenance). Silently skipped on simulators or
 * when no EAS projectId is configured.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('haccp-alerts', {
        name: 'تنبيهات سلامة الغذاء',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;

    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api('/auth/push-token', { method: 'PUT', body: { pushToken } });
  } catch (e) {
    console.warn('Push registration failed', e);
  }
}

export async function unregisterPushNotifications(): Promise<void> {
  await api('/auth/push-token', { method: 'PUT', body: { pushToken: null } }).catch(() => undefined);
}
