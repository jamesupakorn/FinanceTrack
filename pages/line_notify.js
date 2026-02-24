import { useEffect, useMemo, useState } from 'react';
import { withApiTokenHeaders } from '../src/shared/utils/frontend/apiToken';
import styles from '../src/frontend/styles/LineNotify.module.css';

export default function LineNotifyPage() {
  const [message, setMessage] = useState('');
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const webhookUrl = useMemo(() => {
    if (!origin) return '';
    return `${origin}/api/line_webhook`;
  }, [origin]);

  const handleSend = async (event) => {
    event.preventDefault();
    setStatus(null);
    try {
      const response = await fetch('/api/line_notify', {
        method: 'POST',
        headers: withApiTokenHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message, userId: userId || undefined })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'ส่งข้อความไม่สำเร็จ');
      }
      setStatus({ type: 'success', message: 'ส่งข้อความสำเร็จ' });
      setMessage('');
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'เกิดข้อผิดพลาด' });
    }
  };

  const handleCopy = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setStatus({ type: 'success', message: 'คัดลอก Webhook URL แล้ว' });
    } catch (error) {
      setStatus({ type: 'error', message: 'คัดลอกไม่สำเร็จ' });
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.title}>ส่งข้อความ LINE</h1>
        <p className={styles.subtitle}>ใช้สำหรับทดสอบ LINE Messaging API และส่งข้อความแบบ push</p>
        <form className={styles.form} onSubmit={handleSend}>
          <label className={styles.label}>
            ข้อความ
            <textarea
              className={styles.textarea}
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="พิมพ์ข้อความที่จะส่ง"
              required
            />
          </label>
          <label className={styles.label}>
            LINE User ID (ถ้าต้องการส่งให้คนเฉพาะ)
            <input
              className={styles.input}
              type="text"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="Uxxxxxxxxxxxx"
            />
          </label>
          <button className={styles.primaryButton} type="submit">ส่งข้อความ</button>
        </form>
        {status && (
          <div className={status.type === 'success' ? styles.success : styles.error}>{status.message}</div>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>Webhook URL</h2>
        <p className={styles.subtitle}>นำ URL นี้ไปใส่ใน LINE Developers Console → Messaging API → Webhook URL</p>
        <div className={styles.webhookRow}>
          <input className={styles.input} type="text" value={webhookUrl} readOnly placeholder="รัน dev server ก่อนเพื่อให้เห็น URL" />
          <button className={styles.secondaryButton} type="button" onClick={handleCopy} disabled={!webhookUrl}>
            คัดลอก
          </button>
        </div>
        <ul className={styles.list}>
          <li>เปิดใช้งาน Webhook ใน console</li>
          <li>ผู้ใช้ต้องทัก OA ก่อนจึงจะส่ง event มาได้</li>
          <li>ดู log ที่ console เพื่อเช็ก userId จาก webhook</li>
        </ul>
      </section>
    </main>
  );
}
