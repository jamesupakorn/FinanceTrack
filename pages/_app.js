import { ThemeProvider } from '../src/frontend/contexts/ThemeContext';
import '../src/frontend/styles/globals.css';

function MyApp({ Component, pageProps }) {
  return (
    <ThemeProvider>
      <Component {...pageProps} />
    </ThemeProvider>
  );
}

export default MyApp;