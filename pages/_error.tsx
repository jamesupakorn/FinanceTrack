import type { NextPage, NextPageContext } from 'next';

interface ErrorPageProps {
  statusCode?: number;
}

const ErrorPage: NextPage<ErrorPageProps> = ({ statusCode }) => {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h1>เกิดข้อผิดพลาด ({statusCode || 'Unknown'})</h1>
      <p>ขออภัย ข้อมูลไม่สามารถแสดงผลได้ในขณะนี้</p>
    </div>
  );
};

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorPageProps => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default ErrorPage;