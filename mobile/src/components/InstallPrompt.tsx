import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, textStart } from '../theme';

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
/** `solid` renders on a green surface for use on light screens. */
export function InstallPrompt({ solid = false }: { solid?: boolean }) {
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
      <View style={[st.box, solid && st.solid]}>
        <Text style={{ fontSize: 22 }}>📲</Text>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>ثبّت التطبيق على جهازك</Text>
          <Text style={st.text}>أيقونة على الشاشة الرئيسية — بدون متجر تطبيقات</Text>
        </View>
        <Pressable
          style={({ pressed }) => [st.button, pressed && { opacity: 0.85 }]}
          onPress={async () => {
            await deferred.prompt();
            const { outcome } = await deferred.userChoice;
            if (outcome === 'accepted') setInstalled(true);
            setDeferred(null);
          }}
        >
          <Text style={st.buttonText}>تثبيت</Text>
        </Pressable>
      </View>
    );
  }

  if (isIos()) {
    return (
      <View style={[st.box, solid && st.solid]}>
        <Text style={{ fontSize: 22 }}>📲</Text>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>ثبّت التطبيق على الآيفون</Text>
          <Text style={st.text}>من Safari اضغط زر المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية»</Text>
        </View>
      </View>
    );
  }

  return null;
}

const st = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  solid: { backgroundColor: colors.primary, borderColor: colors.primary },
  title: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: textStart },
  text: { color: '#CFE5D9', fontSize: 12, marginTop: 2, textAlign: textStart },
  button: { backgroundColor: colors.accent, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  buttonText: { color: '#1D2939', fontWeight: '800', fontSize: 14 },
});
