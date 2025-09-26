import React from 'react';

function Error({ statusCode }) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h1>เกิดข้อผิดพลาด ({statusCode || 'Unknown'})</h1>
      <p>ขออภัย ข้อมูลไม่สามารถแสดงผลได้ในขณะนี้</p>
    </div>
  );
}

Error.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
