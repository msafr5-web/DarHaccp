// Post-processes the Expo web export into an installable PWA:
// injects the manifest / iOS meta tags and the service-worker registration into dist/index.html.
import { readFileSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const htmlPath = new URL('index.html', dist);
const swPath = new URL('sw.js', dist);

const head = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="دار HACCP" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="description" content="منصة دار الضيافة الرقمية لسلامة الغذاء والجودة (HACCP)" />
`;

const register = `
  <script>
    // Keep the install prompt until the React app mounts (it can fire very early).
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__installPrompt = e; });
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js'); });
    }
  </script>
`;

let html = readFileSync(htmlPath, 'utf8');
if (!html.includes('rel="manifest"')) {
  html = html
    .replace('<html lang="ar">', '<html lang="ar" dir="rtl">')
    .replace('shrink-to-fit=no', 'shrink-to-fit=no, viewport-fit=cover')
    .replace('</head>', `${head}</head>`)
    .replace('</body>', `${register}</body>`);
  writeFileSync(htmlPath, html);
}

// A new cache name per build so installed apps pick up the latest version.
writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('__BUILD_ID__', Date.now().toString(36)));
console.log('PWA: manifest, meta tags and service worker injected');
