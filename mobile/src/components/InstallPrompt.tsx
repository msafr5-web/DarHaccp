import { useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';
import { colors } from '../theme';
import { Button, Card, styles } from './ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * Web only: offers to install the PWA (Android/desktop Chrome & Edge use the native prompt;
 * iOS Safari needs the manual "Add to Home Screen" step). Hidden once installed.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    () => (typeof window !== 'undefined' ? ((window as { __installPrompt?: BeforeInstallPromptEvent }).__installPrompt ?? null) : null),
  );
  const [installed, setInstalled] = useState(Platform.OS !== 'web' || isStandalone());

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  if (deferred) {
    return (
      <Card>
        <Text style={styles.title}>📲 ثبّت التطبيق على جهازك</Text>
        <Text style={[styles.muted, { marginVertical: 6 }]}>يعمل كتطبيق مستقل بأيقونة على الشاشة الرئيسية — بدون متجر تطبيقات.</Text>
        <Button
          title="تثبيت التطبيق"
          onPress={async () => {
            await deferred.prompt();
            const { outcome } = await deferred.userChoice;
            if (outcome === 'accepted') setInstalled(true);
            setDeferred(null);
          }}
        />
      </Card>
    );
  }

  if (isIos()) {
    return (
      <Card style={{ backgroundColor: colors.primaryLight }}>
        <Text style={styles.title}>📲 ثبّت التطبيق على الآيفون</Text>
        <Text style={[styles.body, { marginTop: 6 }]}>
          من متصفح Safari اضغط زر المشاركة ⬆️ ثم اختر «إضافة إلى الشاشة الرئيسية».
        </Text>
      </Card>
    );
  }

  return null;
}
