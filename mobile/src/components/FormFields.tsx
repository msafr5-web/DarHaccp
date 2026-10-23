import { Pressable, Text, View } from 'react-native';
import type { FormField } from '../api/types';
import {
  activeLimits, describeLimits, deviates, inputError, isTime, minutesBetween, nowTime, optionLabel, thisMonth, today, Value, Values,
} from '../formLogic';
import { colors, textStart } from '../theme';
import { Input, styles } from './ui';

export function Chip({ label, selected, onPress, color = colors.primary, disabled }: {
  label: string; selected: boolean; onPress: () => void; color?: string; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1, minWidth: 90, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1.5, alignItems: 'center',
        borderColor: selected ? color : colors.border, backgroundColor: selected ? `${color}1A` : '#fff', opacity: disabled && !selected ? 0.5 : 1,
      }}
    >
      <Text style={{ fontWeight: '700', color: selected ? color : colors.text, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

function NowButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.primaryLight }}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

/** Read-only value: server-calculated, pre-filled from the scanned place, or carried from the previous record. */
function ReadOnly({ field, value, values, note }: { field: FormField; value: Value; values: Values; note: string }) {
  const bad = deviates(field, value, values);
  const shown = value === undefined || value === null || value === '' ? '—' : `${optionLabel(field, value)}${field.unit && typeof value === 'number' ? ` ${field.unit}` : ''}`;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{field.labelAr}</Text>
      <View style={{
        borderRadius: 10, padding: 12, borderWidth: 1, borderStyle: 'dashed',
        borderColor: bad ? colors.danger : colors.border, backgroundColor: bad ? colors.dangerLight : '#F9FAFB',
      }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: bad ? colors.danger : colors.text, textAlign: textStart }}>{shown}</Text>
      </View>
      <Text style={styles.hint}>{note}{field.hint ? ` · ${field.hint}` : ''}</Text>
    </View>
  );
}

/**
 * One input of a digital form with live HACCP feedback: critical limits (incl. conditional ones),
 * refused values, computed and automatic values shown read-only.
 */
export function FieldInput({ field, value, values, onChange, locked }: {
  field: FormField; value: Value; values: Values; onChange: (v: Value) => void;
  /** 'auto' = from the QR location, 'carried' = from the previous record. */
  locked?: 'auto' | 'carried';
}) {
  const label = `${field.labelAr}${field.unit ? ` (${field.unit})` : ''}${field.required || field.ccpMeasurement ? ' *' : ''}`;
  const bad = deviates(field, value, values);
  const error = inputError(field, value, values);

  if (field.compute) return <ReadOnly field={field} value={value} values={values} note="🧮 يُحسب تلقائياً" />;
  if (locked === 'auto') return <ReadOnly field={field} value={value} values={values} note="📍 من موقع رمز QR" />;
  if (locked === 'carried') return <ReadOnly field={field} value={value} values={values} note="↪ مُرحَّل آلياً من السجل السابق" />;

  if (field.type === 'boolean') {
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.row}>
          <Chip label="نعم" selected={value === true} onPress={() => onChange(true)} color={field.expected === false ? colors.danger : colors.success} />
          <Chip label="لا" selected={value === false} onPress={() => onChange(false)} color={field.expected === true ? colors.danger : colors.success} />
        </View>
        {bad ? <Text style={[styles.hint, { color: colors.danger }]}>إجابة غير مطابقة — سيتم فتح إجراء تصحيحي</Text>
          : field.hint ? <Text style={styles.hint}>{field.hint}</Text> : null}
      </View>
    );
  }

  if (field.type === 'select' && !(field.companyOptions && !field.options?.length)) {
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {field.options?.map((o) => (
            <Chip key={o} label={optionLabel(field, o)} selected={value === o} onPress={() => onChange(o)}
              color={o === field.onCriticalDeviation ? colors.danger : colors.primary} />
          ))}
        </View>
        {field.hint ? <Text style={styles.hint}>{field.hint}</Text> : null}
      </View>
    );
  }

  if (field.type === 'time') {
    const start = field.durationFrom ? values[field.durationFrom] : undefined;
    const elapsed = field.durationFrom && isTime(start) && isTime(value) ? minutesBetween(start, value) : null;
    const limit = field.durationFrom && field.maxMinutes ? `المدة ≤ ${field.maxMinutes} دقيقة` : '';
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Input value={typeof value === 'string' ? value : ''} onChangeText={onChange} placeholder="HH:MM" error={bad || !!error}
              keyboardType="numbers-and-punctuation" style={{ marginBottom: -14 }} />
          </View>
          <NowButton label="الآن" onPress={() => onChange(nowTime())} />
        </View>
        {limit || elapsed !== null || error ? (
          <Text style={[styles.hint, (bad || error) && { color: colors.danger }]}>
            {error ?? `${elapsed !== null ? `المدة: ${Math.floor(elapsed / 60)} س ${elapsed % 60} د · ` : ''}${limit}${bad ? ' — تجاوز الحد!' : ''}`}
          </Text>
        ) : null}
      </View>
    );
  }

  if (field.type === 'date' || field.type === 'month') {
    const isMonth = field.type === 'month';
    return (
      <View style={{ marginBottom: 14 }}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Input value={typeof value === 'string' ? value : ''} onChangeText={onChange} placeholder={isMonth ? 'YYYY-MM' : 'YYYY-MM-DD'}
              error={!!error} keyboardType="numbers-and-punctuation" style={{ marginBottom: -14 }} />
          </View>
          <NowButton label={isMonth ? 'هذا الشهر' : 'اليوم'} onPress={() => onChange(isMonth ? thisMonth() : today())} />
        </View>
        {error || field.hint ? <Text style={[styles.hint, error ? { color: colors.danger } : null]}>{error ?? field.hint}</Text> : null}
      </View>
    );
  }

  const limits = field.type === 'number' ? activeLimits(field, values) : {};
  const limitText = describeLimits(limits, field.unit);
  const conditional = field.limitsBy && !limitText && Object.keys(field.limitsBy.cases).length ? 'الحد الحرج يتحدد حسب الاختيار أعلاه' : '';
  const hint = error ? `⛔ ${error}`
    : bad ? `⚠ خارج الحد الحرج (${limitText}) — انحراف`
    : [limitText && `الحد الحرج: ${limitText}`, conditional, field.hint, field.companyOptions ? 'القائمة المعتمدة فارغة — يمكن لمسؤول الجودة إضافتها' : '']
      .filter(Boolean).join(' · ');
  return (
    <Input
      label={label}
      value={value === undefined || value === null ? '' : String(value)}
      onChangeText={onChange}
      keyboardType={field.type === 'number' ? 'numbers-and-punctuation' : 'default'}
      placeholder={limitText || ''}
      error={bad || !!error}
      hint={hint || undefined}
      autoCapitalize="none"
      style={field.ccpMeasurement || field.critical ? { fontSize: 22, fontWeight: '800' } : undefined}
    />
  );
}

/** Read-only display of a captured answer (record view). */
export function AnswerRow({ field, value, deviating }: { field: FormField; value: unknown; deviating?: boolean }) {
  const shown = value === undefined || value === null || value === '' ? '—'
    : typeof value === 'boolean' ? (value ? 'نعم' : 'لا')
    : `${optionLabel(field, value)}${field.unit && typeof value === 'number' ? ` ${field.unit}` : ''}`;
  return (
    <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#F2F4F7' }]}>
      <Text style={[styles.muted, { flex: 1 }]}>{field.labelAr}{field.compute ? ' 🧮' : ''}</Text>
      <Text style={[styles.body, { fontWeight: '700', color: deviating ? colors.danger : colors.text, flexShrink: 1 }]}>
        {deviating ? '⚠ ' : ''}{shown}
      </Text>
    </View>
  );
}
