import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import type { LoginAttempt } from '../api/types';
import { useApi } from '../hooks/useApi';
import { colors } from '../theme';
import { Badge, Card, Chips, Empty, styles } from './ui';

const STAGES: Record<LoginAttempt['stage'], string> = {
  EMAIL: 'طلب رابط الدخول',
  MAGIC_LINK: 'الدخول بالرابط',
  OTP: 'رمز التحقق',
  OTP_RESEND: 'إعادة الإرسال',
  PASSWORD: 'كلمة المرور',
};

const REASONS: Record<string, string> = {
  UNKNOWN_EMAIL: 'بريد غير مسجل',
  EMAIL_COOLDOWN: 'طلب متكرر خلال دقيقة (أُعيد استخدام الرسالة السابقة)',
  EMAIL_THROTTLED: 'تجاوز حد الرسائل — حماية من الإغراق',
  MAGIC_LINK_INVALID: 'رابط دخول غير صالح',
  WRONG_PASSWORD: 'كلمة مرور خاطئة',
  UNKNOWN_USER: 'مستخدم غير موجود',
  UNKNOWN_COMPANY: 'رمز شركة غير موجود',
  USER_INACTIVE: 'حساب معطّل',
  ACCOUNT_LOCKED: 'حساب مقفل مؤقتاً',
  OTP_INVALID: 'رمز تحقق خاطئ',
  OTP_EXPIRED: 'رمز منتهي',
  OTP_LOCKED: 'تجاوز محاولات الرمز',
  OTP_COOLDOWN: 'طلب إرسال مبكر',
  OTP_SEND_LIMIT: 'تجاوز حد الإرسال',
  OTP_INVALID_SESSION: 'جلسة تحقق منتهية',
  TENANT_PENDING_REVIEW: 'الشركة قيد المراجعة',
  TENANT_PENDING_VERIFICATION: 'بريد الشركة غير مؤكد',
  TENANT_SUSPENDED: 'الشركة موقوفة',
};

/** Append-only login attempt log (company admins see their company; the platform sees all). */
export function AttemptsList({ path, showCompany }: { path: string; showCompany?: boolean }) {
  const [filter, setFilter] = useState<'ALL' | 'false' | 'true'>('ALL');
  const sep = path.includes('?') ? '&' : '?';
  const { data, error, loading, reload } = useApi<LoginAttempt[]>(`${path}${sep}pageSize=200${filter !== 'ALL' ? `&success=${filter}` : ''}`);

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(a) => String(a.id)}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <Text style={[styles.muted, { marginBottom: 10 }]}>كل محاولة دخول تُسجَّل ولا يمكن تعديلها أو حذفها — بما فيها الفاشلة.</Text>
          <Chips value={filter} onChange={setFilter} options={[
            { value: 'ALL', label: 'الكل' },
            { value: 'false', label: 'الفاشلة', color: colors.danger },
            { value: 'true', label: 'الناجحة', color: colors.success },
          ]} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد محاولات" />}
      renderItem={({ item }) => (
        <Card style={{ borderRightWidth: 4, borderRightColor: item.success ? colors.success : colors.danger, paddingVertical: 12 }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.body, { fontWeight: '700', flex: 1 }]}>{item.user_name ?? item.email ?? '—'}</Text>
            <Badge text={item.success ? `✓ ${STAGES[item.stage]}` : `✗ ${STAGES[item.stage]}`} color={item.success ? colors.success : colors.danger} />
          </View>
          {!item.success && item.failure_reason ? (
            <Text style={[styles.body, { color: colors.danger }]}>{REASONS[item.failure_reason] ?? item.failure_reason}</Text>
          ) : null}
          <Text style={styles.muted}>
            {new Date(item.occurred_at).toLocaleString('ar-SA')} · IP {item.ip_address ?? '—'}
            {showCompany ? ` · ${item.tenant_name ?? `رمز مُدخل: ${item.company_code ?? '—'}`}` : ''}
          </Text>
          {item.user_agent ? <Text style={[styles.muted, { fontSize: 11 }]} numberOfLines={1}>{item.user_agent}</Text> : null}
        </Card>
      )}
    />
  );
}
