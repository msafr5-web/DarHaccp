import type { Equipment } from '../api/types';
import { EQUIPMENT_TYPES } from '../constants';
import { colors } from '../theme';
import { Badge } from './ui';

export const typeInfo = (t: string) => EQUIPMENT_TYPES[t] ?? { label: t, icon: '⚙️' };

/** Monitoring progress of today against the form's minimum frequency (e.g. 1 / 2 readings). */
export function TodayBadge({ e }: { e: Equipment }) {
  if (!e.form_template_id) return <Badge text="بلا نموذج مرتبط" color={colors.muted} />;
  if (!e.min_daily_entries) return <Badge text={`قراءات اليوم: ${e.readings_today}`} color={colors.primary} />;
  const done = e.readings_today >= e.min_daily_entries;
  return <Badge text={`اليوم ${e.readings_today} / ${e.min_daily_entries}`} color={done ? colors.success : colors.warning} />;
}

export function MaintenanceBadge({ e }: { e: Equipment }) {
  if (e.days_to_maintenance === null) return null;
  if (e.days_to_maintenance < 0) return <Badge text={`صيانة متأخرة ${-e.days_to_maintenance} يوم`} color={colors.danger} />;
  if (e.days_to_maintenance <= 7) return <Badge text={`صيانة خلال ${e.days_to_maintenance} يوم`} color={colors.warning} />;
  return null;
}
