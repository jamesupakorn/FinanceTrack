import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="th">
      <Head>
        <meta charSet="UTF-8" />
        
        {/* Mobile optimization */}
        <meta name="description" content="FinanceTrack - Money Management Application" />
        <meta name="theme-color" content="#03081a" />
        <link rel="icon" href="/avatars/skullmoon_income_favicon.ico" sizes="any" />
        <link rel="shortcut icon" href="/avatars/skullmoon_income_favicon.ico" />
        
        {/* iPhone specific optimization */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FinanceTrack" />
        
        {/* Prevent zoom on input focus for iOS */}
        <style>{`
          input[type="text"],
          input[type="number"],
          input[type="email"],
          input[type="password"],
          textarea,
          select {
            font-size: 16px;
          }
        `}</style>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
