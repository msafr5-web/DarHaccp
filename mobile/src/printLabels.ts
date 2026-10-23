import { Platform, Share } from 'react-native';
import type { QrLabel } from './api/types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type LabelSize = 'small' | 'large';

/** A4 sheet of QR labels: 3 per row (small) or 2 per row (large, for walls and cold rooms). */
export function labelsHtml(labels: QrLabel[], size: LabelSize = 'small') {
  const cols = size === 'large' ? 2 : 3;
  const cards = labels.map((l) => `
    <div class="card">
      <div class="company">${esc(l.company)}</div>
      <img src="${l.dataUrl}" alt="">
      <h3>${esc(l.title)}</h3>
      <p class="sub">${esc(l.subtitle)}</p>
      ${l.location ? `<p class="loc">📍 ${esc(l.location)}</p>` : ''}
      <p class="hint">امسح الرمز بكاميرا الجوال لفتح النموذج وتعبئته</p>
    </div>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ملصقات QR</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Tahoma, Arial, sans-serif; margin: 0; color: #1D2939; }
  .grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 6mm; }
  .card { border: 2px solid #0B5D3B; border-radius: 4mm; padding: 4mm; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .company { font-size: 11px; font-weight: 700; color: #0B5D3B; border-bottom: 1px solid #E3F1EA; padding-bottom: 2mm; }
  img { width: 100%; max-width: ${size === 'large' ? 75 : 50}mm; image-rendering: pixelated; }
  h3 { margin: 1mm 0; font-size: ${size === 'large' ? 18 : 14}px; }
  .sub { margin: 0; font-size: 11px; direction: rtl; }
  .loc { margin: 1mm 0 0; font-size: 11px; font-weight: 700; }
  .hint { margin: 2mm 0 0; font-size: 9px; color: #667085; }
</style></head><body><div class="grid">${cards}</div></body></html>`;
}

/**
 * Prints the labels. Web / installed PWA: a hidden frame with the A4 sheet and the browser's
 * print dialog (also "Save as PDF"). Native app: shares the links (print from the web console).
 */
export async function printLabels(labels: QrLabel[], size: LabelSize = 'small') {
  if (!labels.length) return;
  if (Platform.OS !== 'web') {
    await Share.share({ message: labels.map((l) => `${l.title} — ${l.subtitle}\n${l.payload}`).join('\n\n') });
    return;
  }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(labelsHtml(labels, size));
  doc.close();
  // Wait for the QR images before printing.
  await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60_000);
}

/** Shares / copies one QR link. */
export async function shareLink(label: QrLabel) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    if (navigator.share) {
      await navigator.share({ title: label.title, url: label.payload }).catch(() => undefined);
      return 'shared';
    }
    await navigator.clipboard?.writeText(label.payload);
    return 'copied';
  }
  await Share.share({ message: `${label.title}\n${label.payload}` });
  return 'shared';
}
