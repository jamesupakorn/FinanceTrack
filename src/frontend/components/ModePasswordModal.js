import React, { useState } from 'react';

const ModePasswordModal = ({ open, onClose, onSubmit }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (password.trim() === '') {
      setError('กรุณากรอกรหัสผ่าน');
      return;
    }
    setError('');
    onSubmit(password);
    setPassword('');
  };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.3)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <form onSubmit={handleSubmit} style={{ background: 'white', borderRadius: 12, padding: 32, minWidth: 320, boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
        <h3 style={{ marginBottom: 16 }}>ใส่รหัสผ่านเพื่อเข้าโหมดแก้ไข</h3>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="รหัสผ่าน"
          style={{ width: '100%', padding: 12, fontSize: 16, borderRadius: 8, border: '1px solid #ccc', marginBottom: 12 }}
        />
        {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#eee' }}>ยกเลิก</button>
          <button type="submit" style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1d4ed8', color: 'white' }}>ยืนยัน</button>
        </div>
      </form>
    </div>
  );
};

export default ModePasswordModal;
