import Head from 'next/head';
import { ThemeProvider } from '../src/frontend/contexts/ThemeContext';
import { SessionProvider } from '../src/frontend/contexts/SessionContext';
import Toast from '../src/frontend/components/Toast';
import '../src/frontend/styles/globals.css';

function MyApp({ Component, pageProps }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover" />
        </Head>
        {/* Toast ต้อง mount ก่อน Component เสมอ — ถ้าสลับลำดับ effect ของหน้าที่ยิง showToast()
            ทันทีตอน mount (เช่น EditRedirect) อาจ dispatch เหตุการณ์ app:toast ก่อนที่ Toast จะ
            ผูก window.addEventListener ทัน (mount-order race, พบจาก Stage 4 bug log) */}
        <Toast />
        <Component {...pageProps} />
      </SessionProvider>
    </ThemeProvider>
  );
}

export default MyApp;