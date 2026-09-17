import Head from 'next/head';
import { Anuphan, IBM_Plex_Mono } from 'next/font/google';
import { ThemeProvider } from '../src/frontend/contexts/ThemeContext';
import { SessionProvider } from '../src/frontend/contexts/SessionContext';
import Toast from '../src/frontend/components/Toast';
import ErrorBoundary from '../src/frontend/components/ErrorBoundary';
import '../src/frontend/styles/globals.css';

// Graphite redesign fonts (UX_SPEC §3.2), self-hosted at build time via next/font — no runtime
// request to fonts.googleapis.com (ADR-019 rule 7). Only the 4 weights the type scale actually
// uses are loaded (400 body, 500 emphasis/labels, 600 headings/money, 700 the hero figure).
// `variable` sets these as CSS custom properties named to match globals.css's own §3.2 token names,
// so they shadow (for anything inside the wrapper below) the literal fallback strings globals.css
// defines at :root for contexts outside this wrapper.
const anuphan = Anuphan({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans'
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-numeric'
});

function MyApp({ Component, pageProps }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover" />
          {/* SEO/OG meta tags (TD-L02) — copy reused verbatim from package.json/manifest.json,
              not re-authored. Sitewide default here since no page currently overrides <Head>. */}
          <title>FinanceTrack — บัญชีรับจ่ายย้อนหลัง 12 เดือน</title>
          <meta name="description" content="บัญชีรับจ่ายย้อนหลัง 12 เดือน" />
          <meta property="og:title" content="FinanceTrack" />
          <meta property="og:description" content="บัญชีรับจ่ายย้อนหลัง 12 เดือน" />
          <meta property="og:type" content="website" />
          <meta property="og:site_name" content="FinanceTrack" />
          <meta property="og:image" content="/icons/icon-512.png" />
          <meta name="twitter:card" content="summary" />
        </Head>
        {/* No pages/_document.js exists in this Pages Router project, and Foundation deliberately
            doesn't add one (architecture-review-foundation.md) — so the font-variable classes are
            applied at this wrapper, the highest common ancestor _app.js actually renders, instead
            of on <html>/<body>. */}
        <div className={`${anuphan.variable} ${ibmPlexMono.variable}`}>
          {/* Toast ต้อง mount ก่อน Component เสมอ — ถ้าสลับลำดับ effect ของหน้าที่ยิง showToast()
              ทันทีตอน mount (เช่น EditRedirect) อาจ dispatch เหตุการณ์ app:toast ก่อนที่ Toast จะ
              ผูก window.addEventListener ทัน (mount-order race, พบจาก Stage 4 bug log) */}
          <Toast />
          <ErrorBoundary>
            <Component {...pageProps} />
          </ErrorBoundary>
        </div>
      </SessionProvider>
    </ThemeProvider>
  );
}

export default MyApp;