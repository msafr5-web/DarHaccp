import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, styles } from '@/components/ui';
import { colors } from '@/theme';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const handled = useRef(false);

  // Only one camera preview may run at a time: mount it only while this tab is focused.
  useFocusEffect(
    useCallback(() => {
      handled.current = false;
      setActive(true);
      return () => setActive(false);
    }, []),
  );

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (handled.current) return;
    handled.current = true;
    setActive(false);
    router.push({ pathname: '/form', params: { payload: data } });
  };

  if (!permission) return <View style={styles.center} />;

  if (!permission.granted) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Text style={[styles.body, { textAlign: 'center', marginBottom: 16 }]}>
          نحتاج إذن الكاميرا لمسح رموز QR الموجودة على الأجهزة ومحطات العمل.
        </Text>
        <Button title="السماح باستخدام الكاميرا" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {active ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
      ) : null}
      <View style={scan.overlay} pointerEvents="none">
        <View style={scan.frame} />
        <Text style={scan.hint}>وجّه الكاميرا نحو رمز QR على الجهاز أو محطة العمل</Text>
      </View>
    </View>
  );
}

const scan = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 250, height: 250, borderWidth: 3, borderColor: colors.accent, borderRadius: 24 },
  hint: { color: '#fff', marginTop: 24, fontSize: 15, fontWeight: '600', textAlign: 'center', paddingHorizontal: 24 },
});
