import { FlatList, Linking, RefreshControl, Text, View } from 'react-native';
import type { ControlledDocument } from '@/api/types';
import { Badge, Button, Card, Empty, OfflineNote, styles } from '@/components/ui';
import { DOCUMENT_CATEGORIES } from '@/constants';
import { useApi } from '@/hooks/useApi';
import { colors } from '@/theme';

const REVIEW = {
  CURRENT: { label: 'سارية', color: colors.success },
  DUE_SOON: { label: 'مراجعة قريبة', color: colors.warning },
  OVERDUE: { label: 'متأخرة المراجعة', color: colors.danger },
  NO_REVIEW: { label: 'بدون موعد مراجعة', color: colors.muted },
} as const;

/** IMS controlled documents: policies, HACCP plan, evacuation plans, extinguisher layouts (PRD §2.1-1, §4.1). */
export default function DocumentsScreen() {
  const { data, error, loading, offline, reload } = useApi<ControlledDocument[]>('/documents');

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(d) => d.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={<View><OfflineNote show={offline} />{error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}</View>}
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد وثائق" />}
      renderItem={({ item }) => (
        <Card>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.title, { fontSize: 15, flex: 1 }]}>{item.title}</Text>
            <Badge text={REVIEW[item.review_state].label} color={REVIEW[item.review_state].color} />
          </View>
          <Text style={styles.muted}>
            {item.doc_no} · {DOCUMENT_CATEGORIES[item.category]} · الإصدار {item.version} · ساري من {item.effective_date}
            {item.review_date ? ` · المراجعة ${item.review_date}` : ''}
          </Text>
          {item.owner_name ? <Text style={styles.muted}>المالك: {item.owner_name}</Text> : null}
          {item.file_url ? (
            <Button title="📄 فتح الوثيقة" variant="outline" onPress={() => Linking.openURL(item.file_url!)} />
          ) : (
            <Text style={[styles.muted, { marginTop: 4 }]}>لم يُرفق ملف بعد</Text>
          )}
        </Card>
      )}
    />
  );
}
