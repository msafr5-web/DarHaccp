import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { Button, Card, Input, styles } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { colors } from '@/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.primary }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <Text style={{ fontSize: 30, fontWeight: '800', color: '#fff' }}>دار الضيافة</Text>
          <Text style={{ fontSize: 15, color: colors.primaryLight, marginTop: 6 }}>نظام سلامة الغذاء والجودة · HACCP</Text>
        </View>
        <Card>
          <Text style={[styles.title, { marginBottom: 16 }]}>تسجيل الدخول</Text>
          <Input
            label="البريد الإلكتروني"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="name@daraldhiafa.sa"
          />
          <Input label="كلمة المرور" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 8, textAlign: 'left' }}>{error}</Text> : null}
          <Button title="دخول" onPress={submit} loading={busy} disabled={!email || !password} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
