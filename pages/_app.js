import Head from 'next/head';
import { ThemeProvider } from '../src/frontend/contexts/ThemeContext';
import { SessionProvider } from '../src/frontend/contexts/SessionContext';
import '../src/frontend/styles/globals.css';

function MyApp({ Component, pageProps }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover" />
        </Head>
        <Component {...pageProps} />
      </SessionProvider>
    </ThemeProvider>
  );
}

export default MyApp;