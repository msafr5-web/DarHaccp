import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { Item, StorageCondition } from '@/api/types';
import { ItemsExcel } from '@/components/ItemsExcel';
import { Badge, Button, Card, Chips, Empty, Input, styles } from '@/components/ui';
import { STORAGE_CONDITION } from '@/constants';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { colors, textStart } from '@/theme';

const CONDITIONS = Object.keys(STORAGE_CONDITION) as StorageCondition[];

/** Add or edit an item. The code is the key used in every record and stock batch, so it is fixed once saved. */
function ItemForm({ item, onSaved, onCancel }: { item: Item | null; onSaved: () => void; onCancel: () => void }) {
  const [code, setCode] = useState(item?.code ?? '');
  const [nameAr, setNameAr] = useState(item?.name_ar ?? '');
  const [nameEn, setNameEn] = useState(item?.name_en ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [storage, setStorage] = useState<StorageCondition>(item?.storage_condition ?? 'AMBIENT');
  const [unit, setUnit] = useState(item?.unit ?? 'كغ');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { nameAr: nameAr.trim(), nameEn: nameEn.trim() || undefined, category: category.trim() || undefined, storageCondition: storage, unit: unit.trim() };
    try {
      if (item) await api(`/items/${item.id}`, { method: 'PATCH', body: { ...body, nameEn: body.nameEn ?? null, category: body.category ?? null } });
      else await api('/items', { method: 'POST', body: { ...body, code: code.trim() } });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ borderColor: colors.primary }}>
      <Text style={styles.title}>{item ? `تعديل ${item.code}` : 'صنف جديد'}</Text>
      {item ? <Text style={[styles.muted, { marginBottom: 8 }]}>كود الصنف ثابت — تُربط به السجلات وتشغيلات المخزون.</Text> : (
        <Input label="كود الصنف *" value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" placeholder="ITM-1001" />
      )}
      <Input label="الاسم بالعربية *" value={nameAr} onChangeText={setNameAr} />
      <Input label="الاسم بالإنجليزية" value={nameEn} onChangeText={setNameEn} />
      <Input label="الفئة" value={category} onChangeText={setCategory} placeholder="ألبان، لحوم، حبوب…" />
      <Text style={styles.label}>شرط التخزين</Text>
      <Chips value={storage} onChange={setStorage}
        options={CONDITIONS.map((c) => ({ value: c, label: `${STORAGE_CONDITION[c]!.icon} ${STORAGE_CONDITION[c]!.label}`, color: STORAGE_CONDITION[c]!.color }))} />
      <Input label="الوحدة" value={unit} onChangeText={setUnit} placeholder="كغ، لتر، كرتون" />
      {error ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: textStart }}>{error}</Text> : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button title="حفظ" loading={busy} disabled={nameAr.trim().length < 2 || (!item && !code.trim()) || !unit.trim()} onPress={save} />
        </View>
        <View style={{ flex: 1 }}><Button title="إلغاء" variant="outline" onPress={onCancel} /></View>
      </View>
    </Card>
  );
}

/** Item master: the list every form item code is checked against (foreign key), with stock on hand. */
export default function ItemsScreen() {
  const { can } = useAuth();
  const manage = can('item:manage');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const q = new URLSearchParams({ ...(search.trim() ? { search: search.trim() } : {}), ...(showInactive ? { all: 'true' } : {}) });
  const { data, error, loading, reload } = useApi<Item[]>(`/items?${q}`);
  const [rowError, setRowError] = useState<string | null>(null);

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={data ?? []}
      keyExtractor={(i) => i.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      ListHeaderComponent={
        <View>
          <Card style={{ backgroundColor: colors.primaryLight }}>
            <Text style={styles.body}>
              جدول الأصناف الرئيسي (Item Master): لا يقبل أي نموذج كود صنف غير مسجّل هنا، ويُملأ اسم الصنف تلقائياً.
            </Text>
          </Card>
          <ItemsExcel canImport={manage} onImported={() => void reload()} />
          {manage ? (editing === 'new'
            ? <ItemForm item={null} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
            : <Button title="➕ صنف جديد" onPress={() => setEditing('new')} />) : null}
          <View style={{ height: 10 }} />
          <Input placeholder="بحث بالكود أو الاسم أو الفئة" value={search} onChangeText={setSearch} />
          {manage ? (
            <Chips value={showInactive ? 'all' : 'active'} onChange={(v) => setShowInactive(v === 'all')}
              options={[{ value: 'active', label: 'النشطة' }, { value: 'all', label: 'الكل (مع الموقوفة)' }]} />
          ) : null}
          {error || rowError ? <Text style={{ color: colors.danger, marginBottom: 12, textAlign: textStart }}>{error ?? rowError}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? undefined : <Empty text="لا توجد أصناف" />}
      renderItem={({ item }) => {
        if (editing !== 'new' && editing?.id === item.id) {
          return <ItemForm item={item} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />;
        }
        const st = STORAGE_CONDITION[item.storage_condition]!;
        return (
          <Card style={{ opacity: item.is_active ? 1 : 0.55 }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={{ fontSize: 24 }}>{st.icon}</Text>
              <View style={{ flex: 1, marginHorizontal: 8 }}>
                <Text style={[styles.body, { fontWeight: '800' }]}>{item.name_ar}</Text>
                <Text style={[styles.muted, { color: colors.primary, fontWeight: '700' }]} selectable>{item.code}</Text>
              </View>
              <Badge text={st.label} color={st.color} />
            </View>
            <Text style={[styles.muted, { marginTop: 4 }]}>
              {item.category ? `${item.category} · ` : ''}الرصيد {item.stock_quantity} {item.unit} في {item.batches_count} تشغيلة
              {item.is_active ? '' : ' · موقوف'}
            </Text>
            {manage ? (
              <View style={[styles.row, { marginTop: 6 }]}>
                <Pressable onPress={() => setEditing(item)}><Text style={{ color: colors.primary, fontWeight: '700' }}>✏️ تعديل</Text></Pressable>
                <Pressable onPress={async () => {
                  setRowError(null);
                  try {
                    await api(`/items/${item.id}`, { method: 'PATCH', body: { isActive: !item.is_active } });
                    void reload();
                  } catch (e) {
                    setRowError(errorMessage(e));
                  }
                }}>
                  <Text style={{ color: item.is_active ? colors.danger : colors.success, fontWeight: '700', marginHorizontal: 16 }}>
                    {item.is_active ? 'إيقاف' : 'تفعيل'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </Card>
        );
      }}
    />
  );
}
