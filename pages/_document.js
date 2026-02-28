import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="th">
      <Head>
        {/* Viewport meta tag for optimal mobile experience */}
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover" />
        
        {/* Mobile optimization */}
        <meta name="description" content="FinanceTrack - Money Management Application" />
        <meta name="theme-color" content="#03081a" />
        
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
