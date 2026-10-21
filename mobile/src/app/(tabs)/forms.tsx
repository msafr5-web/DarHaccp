import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '@/api/client';
import type { FormTemplateSummary } from '@/api/types';
import { Badge, Card, Empty, OfflineNote, styles } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { cacheForm } from '@/offline';
import { colors, departmentLabel } from '@/theme';

let prefetched = false;

/** Caches every form definition once per session so all forms can be filled offline. */
async function prefetchForms(templates: FormTemplateSummary[]) {
  if (prefetched) return;
  prefetched = true;
  for (const t of templates) {
    try {
      await cacheForm(t.qr_token, await api('/qr/resolve', { method: 'POST', body: { payload: t.qr_token } }));
    } catch {
      prefetched = false; // retry next time the list loads online
      return;
    }
  }
}

/** Manual fallback when a QR label is missing or damaged. */
export default function FormsScreen() {
  const { data: templates, error, loading, offline, reload } = useApi<FormTemplateSummary[]>('/haccp/templates');

  useEffect(() => {
    if (templates && !offline) void prefetchForms(templates);
  }, [templates, offline]);

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={templates ?? []}
      keyExtractor={(t) => t.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <OfflineNote show={offline} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
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
