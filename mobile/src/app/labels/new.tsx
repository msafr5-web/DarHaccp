import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { api, errorMessage } from '@/api/client';
import type { ProductLabel, Recipe } from '@/api/types';
import { Button, Card, Chips, Empty, Input, Loading, styles } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { colors, textStart } from '@/theme';

const shelfLife = (h: number) => (h < 48 ? `${h} ساعة` : `${Math.round(h / 24)} يوم`);

export default function NewLabelScreen() {
  const { data: recipes, error: loadError } = useApi<Recipe[]>('/recipes');
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [batchNo, setBatchNo] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('قطعة');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loadError) return <Empty text={loadError} />;
  if (!recipes) return <Loading />;
  const recipe = recipes.find((r) => r.id === recipeId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const label = await api<ProductLabel>('/labels', {
        method: 'POST',
        body: { recipeId, batchNo: batchNo.trim(), quantity: Number(quantity), unit: unit.trim() || undefined },
      });
      router.replace({ pathname: '/labels/[id]', params: { id: label.id } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.label}>الوصفة المعتمدة *</Text>
        <Chips options={recipes.map((r) => ({ value: r.id, label: r.name_ar }))} value={recipeId} onChange={setRecipeId} />
        {recipe ? (
          <Card style={{ backgroundColor: colors.primaryLight, borderColor: colors.primaryLight }}>
            <Text style={styles.body}>مدة الصلاحية: <Text style={{ fontWeight: '800' }}>{shelfLife(recipe.shelf_life_hours)}</Text> من وقت الإنتاج</Text>
            <Text style={styles.body}>المكونات: {recipe.ingredients.map((i) => i.name).join('، ')}</Text>
            {recipe.allergens.length ? <Text style={[styles.body, { color: colors.warning, fontWeight: '700' }]}>مسببات الحساسية: {recipe.allergens.join('، ')}</Text> : null}
            {recipe.storage_instructions ? <Text style={styles.muted}>{recipe.storage_instructions}</Text> : null}
          </Card>
        ) : null}
        <Input label="رقم الدفعة *" value={batchNo} onChangeText={setBatchNo} />
        <Input label="الكمية *" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
        <Input label="الوحدة" value={unit} onChangeText={setUnit} />
      </Card>
      {error ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: textStart }}>{error}</Text> : null}
      <Button title="إصدار البطاقة" onPress={submit} loading={busy}
        disabled={!recipeId || !batchNo.trim() || !(Number(quantity) > 0)} />
    </ScrollView>
  );
}
