import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, Vibration, View } from 'react-native';
import { api } from '../api/client';
import type { Alert } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { colors, textStart } from '../theme';

const POLL_MS = 60_000;

/** Short alarm tone (web: generated with WebAudio, no file to download). */
function playAlarm() {
  if (Platform.OS !== 'web') {
    Vibration.vibrate([0, 600, 250, 600, 250, 600]);
    return;
  }
  try {
    const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume();
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = i % 2 ? 660 : 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.45;
      osc.start(t);
      osc.stop(t + 0.3);
    }
    setTimeout(() => void ctx.close(), 2000);
    (navigator as Navigator & { vibrate?: (p: number[]) => boolean }).vibrate?.([300, 150, 300]);
  } catch { /* audio blocked until the first user interaction */ }
}

/**
 * Immediate alarm (PRD: audible alarm / instant message to the quality manager): while the app is open,
 * new CRITICAL / HIGH alerts — CCP breaches, monitoring overdue, expired stock — sound an alarm and show
 * a banner. Open alerts already present at sign-in are not re-announced.
 */
export function AlertAlarm() {
  const { user, isPlatform } = useAuth();
  const seen = useRef<Set<string> | null>(null);
  const [banner, setBanner] = useState<Alert | null>(null);

  const poll = useCallback(async () => {
    try {
      const alerts = await api<Alert[]>('/alerts?status=OPEN&pageSize=50');
      const urgent = alerts.filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH');
      if (seen.current === null) {
        seen.current = new Set(urgent.map((a) => a.id));
        return;
      }
      const fresh = urgent.filter((a) => !seen.current!.has(a.id));
      fresh.forEach((a) => seen.current!.add(a.id));
      if (fresh.length) {
        setBanner(fresh[0]!);
        playAlarm();
      }
    } catch { /* offline: try again next time */ }
  }, []);

  useEffect(() => {
    if (!user || isPlatform) {
      seen.current = null;
      return;
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    // Web: check at once when the user comes back to the tab / installed app.
    const web = Platform.OS === 'web' && typeof document !== 'undefined';
    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    if (web) document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      if (web) document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, isPlatform, poll]);

  if (!banner) return null;
  return (
    <View style={{
      position: 'absolute', top: 70, left: 12, right: 12, zIndex: 1000, backgroundColor: colors.danger, borderRadius: 14, padding: 14,
      shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, elevation: 12,
    }}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16, textAlign: textStart }}>🚨 {banner.title}</Text>
      <Text style={{ color: '#fff', marginTop: 4, textAlign: textStart }} numberOfLines={3}>{banner.message}</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        <Pressable onPress={() => { setBanner(null); router.push('/alerts'); }}
          style={{ backgroundColor: '#fff', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 }}>
          <Text style={{ color: colors.danger, fontWeight: '800' }}>عرض التنبيه</Text>
        </Pressable>
        <Pressable onPress={() => setBanner(null)} style={{ borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: '#fff' }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>إخفاء</Text>
        </Pressable>
      </View>
    </View>
  );
}
