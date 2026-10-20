import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { FormTemplateSummary } from '@/api/types';
import { Badge, Card, Empty, styles } from '@/components/ui';
import { colors, departmentLabel } from '@/theme';

/** Manual fallback when a QR label is missing or damaged. */
export default function FormsScreen() {
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await api<FormTemplateSummary[]>('/haccp/templates'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={templates}
      keyExtractor={(t) => t.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListHeaderComponent={error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : undefined}
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد نماذج متاحة لقسمك" />}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/form', params: { payload: item.qr_token, source: 'MANUAL' } })}>
          <Card>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.title, { fontSize: 16, flex: 1 }]}>{item.title_ar}</Text>
              {item.ccp_id ? <Badge text="CCP" color={colors.danger} /> : undefined}
            </View>
            <Text style={styles.muted}>
              {item.title_en} · {item.department_code ? departmentLabel[item.department_code] : 'جميع الأقسام'}
            </Text>
          </Card>
        </Pressable>
      )}
    />
  );
}
