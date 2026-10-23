import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { apiDownload, apiUpload, errorMessage } from '../api/client';
import { colors, textStart } from '../theme';
import { Badge, Button, Card, Stat, styles } from './ui';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 4 * 1024 * 1024;

interface ImportResult {
  total: number;
  create: number;
  update: number;
  unchanged: number;
  errors: { row: number; message: string }[];
  changes: { row: number; code: string; name_ar: string; action: 'create' | 'update' | 'unchanged'; changes: string[] }[];
  applied: boolean;
}

/** Opens the browser's file picker for one .xlsx file. */
function pickXlsx(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/**
 * Item master ⇄ Excel: export the list, download a blank template, and import / update in bulk.
 * Import shows a preview (new, updated, errors per row) and applies only when the whole file is valid.
 */
export function ItemsExcel({ canImport, onImported }: { canImport: boolean; onImported: () => void }) {
  const [busy, setBusy] = useState<'export' | 'template' | 'check' | 'apply' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  if (Platform.OS !== 'web') {
    return (
      <Card>
        <Text style={styles.muted}>📊 تصدير واستيراد Excel متاح من المتصفح أو التطبيق المثبّت من المتصفح.</Text>
      </Card>
    );
  }

  const download = async (template: boolean) => {
    setBusy(template ? 'template' : 'export');
    setMsg(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await apiDownload(`/items/export.xlsx${template ? '?template=true' : ''}`, template ? 'قالب-الأصناف.xlsx' : `الأصناف-${date}.xlsx`);
    } catch (e) {
      setMsg({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setMsg(null);
    const f = await pickXlsx();
    if (!f) return;
    if (f.size > MAX_BYTES) return setMsg({ text: 'حجم الملف أكبر من 4 ميجابايت — قسّمه إلى ملفين', ok: false });
    setBusy('check');
    try {
      setPreview(await apiUpload<ImportResult>('/items/import', f, XLSX));
      setFile(f);
    } catch (e) {
      setMsg({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!file) return;
    setBusy('apply');
    setMsg(null);
    try {
      const r = await apiUpload<ImportResult>('/items/import?apply=true', file, XLSX);
      setPreview(null);
      setFile(null);
      setMsg({ text: `تم التحديث: ${r.create} صنف جديد، ${r.update} صنف معدّل`, ok: true });
      onImported();
    } catch (e) {
      setMsg({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(null);
    }
  };

  const nothing = preview && !preview.create && !preview.update;
  return (
    <Card>
      <Text style={styles.title}>📊 Excel</Text>
      <Text style={[styles.muted, { marginBottom: 8 }]}>
        صدّر الأصناف، عدّلها أو أضف إليها في Excel، ثم استوردها لتحديث الجدول دفعة واحدة. يُعرض ملخص التغييرات قبل التطبيق.
      </Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <View style={{ flex: 1, minWidth: 170 }}>
          <Button title="⬇️ تصدير إلى Excel" variant="outline" loading={busy === 'export'} onPress={() => void download(false)} />
        </View>
        <View style={{ flex: 1, minWidth: 170 }}>
          <Button title="📄 تنزيل قالب فارغ" variant="outline" loading={busy === 'template'} onPress={() => void download(true)} />
        </View>
        {canImport ? (
          <View style={{ flex: 1, minWidth: 170 }}>
            <Button title="⬆️ استيراد / تحديث من Excel" loading={busy === 'check'} onPress={() => void check()} />
          </View>
        ) : null}
      </View>
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: 4, textAlign: textStart }}>{msg.text}</Text> : null}

      {preview ? (
        <View style={{ marginTop: 10, borderTopWidth: 1, borderColor: '#EAECF0', paddingTop: 10 }}>
          <Text style={[styles.body, { fontWeight: '800' }]}>معاينة الملف: {file?.name}</Text>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <Stat label="صنف جديد" value={preview.create} color={colors.success} />
            <Stat label="سيُحدَّث" value={preview.update} color={colors.primary} />
            <Stat label="بلا تغيير" value={preview.unchanged} color={colors.muted} />
            <Stat label="أخطاء" value={preview.errors.length} color={preview.errors.length ? colors.danger : colors.muted} />
          </View>
          {preview.errors.length ? (
            <View style={{ backgroundColor: colors.dangerLight, borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <Text style={[styles.body, { fontWeight: '800', color: colors.danger, marginBottom: 4 }]}>
                صحّح هذه الصفوف في الملف ثم أعد الاستيراد (لا يُطبَّق أي تغيير مع وجود أخطاء):
              </Text>
              {preview.errors.slice(0, 50).map((e) => (
                <Text key={`${e.row}-${e.message}`} style={[styles.body, { fontSize: 13 }]}>• الصف {e.row}: {e.message}</Text>
              ))}
              {preview.errors.length > 50 ? <Text style={styles.muted}>… و{preview.errors.length - 50} خطأ آخر</Text> : null}
            </View>
          ) : null}
          {preview.changes.slice(0, 60).map((c) => (
            <View key={c.row} style={[styles.row, { paddingVertical: 4, borderBottomWidth: 1, borderColor: '#F2F4F7' }]}>
              <Badge text={c.action === 'create' ? 'جديد' : 'تحديث'} color={c.action === 'create' ? colors.success : colors.primary} />
              <Text style={[styles.body, { flex: 1, fontSize: 13 }]}>
                {c.code} — {c.name_ar}{c.changes.length ? ` (${c.changes.join('، ')})` : ''}
              </Text>
            </View>
          ))}
          {preview.changes.length > 60 ? <Text style={styles.muted}>… و{preview.changes.length - 60} تغيير آخر</Text> : null}
          <View style={[styles.row, { marginTop: 8 }]}>
            <View style={{ flex: 1 }}>
              <Button title={nothing ? 'لا توجد تغييرات' : `✅ تطبيق (${preview.create} إضافة، ${preview.update} تحديث)`}
                loading={busy === 'apply'} disabled={!!preview.errors.length || !!nothing} onPress={() => void apply()} />
            </View>
            <View style={{ flex: 1 }}><Button title="إلغاء" variant="outline" onPress={() => { setPreview(null); setFile(null); }} /></View>
          </View>
        </View>
      ) : null}
    </Card>
  );
}
