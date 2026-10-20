import { Platform } from 'react-native';

export const colors = {
  primary: '#0B5D3B',
  primaryLight: '#E3F1EA',
  accent: '#C8A24A',
  danger: '#B42318',
  dangerLight: '#FDECEA',
  warning: '#B54708',
  warningLight: '#FFF4E5',
  success: '#067647',
  successLight: '#E7F6EC',
  text: '#1D2939',
  muted: '#667085',
  border: '#D0D5DD',
  background: '#F5F7F6',
  card: '#FFFFFF',
};

export const severityColor: Record<string, string> = {
  CRITICAL: colors.danger,
  HIGH: '#D92D20',
  MEDIUM: colors.warning,
  LOW: colors.muted,
};

export const departmentLabel: Record<string, string> = {
  HOT: 'المطبخ الساخن',
  COLD: 'المطبخ البارد',
  SWEETS: 'الحلويات',
  SUPPORT: 'الخدمات المساندة',
};

export const roleLabel: Record<string, string> = {
  ADMIN: 'مدير النظام',
  HACCP_OFFICER: 'مسؤول الهاسب',
  HSE_OFFICER: 'مسؤول الصحة والسلامة',
  KITCHEN_SUPERVISOR: 'مشرف مطبخ',
  CHEF: 'شيف',
};

/**
 * "Start" text alignment for Arabic. Native RTL mode swaps left/right automatically;
 * react-native-web emits a literal CSS `text-align`, so the web build needs 'right'.
 */
export const textStart = Platform.OS === 'web' ? 'right' : 'left';
