import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { CatalogForm } from '@/api/types';
import { Badge, Button, Card, Empty, styles } from '@/components/ui';
import { CATEGORY_LABEL } from '@/constants';
import { useApi } from '@/hooks/useApi';
import { colors, departmentLabel } from '@/theme';

/** Platform form library: every form a company can be given, with its fields and rules. */
export default function CatalogScreen() {
  const { data, error, loading, reload } = useApi<CatalogForm[]>('/platform/catalog');

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(c) => c.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <Card style={{ backgroundColor: colors.primaryLight }}>
            <Text style={styles.body}>
              كل نموذج هنا خاصية يمكن إعطاؤها لأي شركة من شاشة الشركة. تعديل الحقول يصل تلقائياً لكل الشركات المفعّل لديها
              (عدا النسخ المخصصة لشركة معينة)، وتحتفظ السجلات السابقة بإصدارها.
            </Text>
          </Card>
          <Button title="➕ نموذج جديد في المكتبة" onPress={() => router.push({ pathname: '/platform/forms/[id]', params: { id: 'new' } })} />
          <View style={{ height: 8 }} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="المكتبة فارغة" />}
      renderItem={({ item, index }) => {
        const header = index === 0 || data![index - 1]!.category !== item.category;
        return (
          <View>
            {header ? <Text style={[styles.title, { marginVertical: 8 }]}>{CATEGORY_LABEL[item.category] ?? item.category}</Text> : null}
            <Pressable onPress={() => router.push({ pathname: '/platform/forms/[id]', params: { id: item.id } })}>
              <Card style={{ opacity: item.is_active ? 1 : 0.55 }}>
                <View style={[styles.row, { justifyContent: 'space-between' }]}>
                  <Text style={[styles.body, { fontWeight: '800', flex: 1 }]}>{item.title_ar}</Text>
                  <Badge text={`v${item.version}`} color={colors.muted} />
                </View>
                <Text style={styles.muted}>
                  {item.code} · {item.fields.length} حقلاً · {item.department_code ? departmentLabel[item.department_code] : 'كل الأقسام'}
                  {item.min_daily_entries ? ` · ${item.min_daily_entries}× يومياً` : ''}
                </Text>
                <View style={[styles.row, { marginTop: 6, flexWrap: 'wrap' }]}>
                  <Badge text={`مفعّل لدى ${item.companies_count ?? 0} شركة`} color={colors.primary} />
                  {item.is_default ? <Badge text="يُعطى لكل شركة جديدة" color={colors.success} /> : null}
                  {!item.is_active ? <Badge text="موقوف" color={colors.danger} /> : null}
                </View>
              </Card>
            </Pressable>
          </View>
        );
      }}
    />
  );
}
