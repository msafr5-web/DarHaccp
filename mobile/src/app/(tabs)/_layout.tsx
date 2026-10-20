import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '@/theme';

const icon = (glyph: string) => ({ focused }: { focused: boolean }) => (
  <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>
);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'الرئيسية', tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="scan" options={{ title: 'مسح QR', tabBarIcon: icon('📷') }} />
      <Tabs.Screen name="forms" options={{ title: 'النماذج', tabBarIcon: icon('📋') }} />
      <Tabs.Screen name="alerts" options={{ title: 'التنبيهات', tabBarIcon: icon('🔔') }} />
    </Tabs>
  );
}
