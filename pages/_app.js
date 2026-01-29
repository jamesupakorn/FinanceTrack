import { ThemeProvider } from '../src/frontend/contexts/ThemeContext';
import { SessionProvider } from '../src/frontend/contexts/SessionContext';
import '../src/frontend/styles/globals.css';

function MyApp({ Component, pageProps }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <Component {...pageProps} />
      </SessionProvider>
    </ThemeProvider>
  );
}

export default MyApp;