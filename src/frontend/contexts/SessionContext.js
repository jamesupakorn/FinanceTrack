import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { setActiveUserId } from '../../shared/utils/frontend/sessionClient';
import { userSettingsAPI, setSessionInvalidHandler } from '../../shared/utils/frontend/apiUtils';

const STORAGE_KEY = 'financetrack-current-user';
const LAST_ACTIVITY_KEY = 'financetrack-last-activity';
const SESSION_TIMEOUT_MS = 60 * 60 * 1000;

const SessionContext = createContext(null);

export const useSession = () => {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession ต้องใช้ภายใน SessionProvider');
  }
  return ctx;
};

export const SessionProvider = ({ children }) => {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [isReady, setIsReady] = useState(false);

  // TD-C02 B3: ข้อมูลใน localStorage เป็น "display-only" — ใช้แสดงชื่อ/รูปโปรไฟล์ทันทีโดยไม่ต้อง
  // ยิง network ไม่ใช่หลักฐานว่ายังมี session อยู่ ตัวตัดสินจริงคือ session cookie ฝั่งเซิร์ฟเวอร์
  // (ถ้า cookie หมดอายุ API จะตอบ 401 แล้ว handler ด้านล่างจะพากลับไป /profiles เอง)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setCurrentUser(parsed);
        setActiveUserId(parsed?.id || null);
      }
      const lastActivity = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY), 10);
      if (lastActivity && Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        setCurrentUser(null);
        setActiveUserId(null);
      }
    } catch (err) {
      console.error('โหลดข้อมูลผู้ใช้จาก localStorage ไม่สำเร็จ', err);
    } finally {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return undefined;
    const updateActivity = () => {
      localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    };
    updateActivity();
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, updateActivity));
    const interval = setInterval(() => {
      const last = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY), 10);
      if (last && Date.now() - last > SESSION_TIMEOUT_MS) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        setCurrentUser(null);
        setActiveUserId(null);
      }
    }, 60 * 1000);
    return () => {
      events.forEach(event => window.removeEventListener(event, updateActivity));
      clearInterval(interval);
    };
  }, [currentUser]);

  const persistUser = useCallback((user) => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const selectUser = useCallback((user) => {
    setCurrentUser(user);
    setActiveUserId(user?.id || null);
    persistUser(user);
    
    // โหลดบัญชีธนาคารของผู้ใช้
    if (user?.id) {
      userSettingsAPI.get()
        .then(data => {
          if (data.bankAccounts) {
            setCurrentUser(prev => ({
              ...prev,
              bankAccounts: data.bankAccounts
            }));
          }
        })
        .catch(error => console.warn('Could not load user bank accounts:', error));
    }
  }, [persistUser]);

  const logout = useCallback(async () => {
    // ล้าง state ฝั่ง client ก่อนเสมอ (แบบ synchronous) — ผู้เรียกทุกจุดไม่ await แล้ว navigate ต่อทันที
    // ถ้าปล่อยให้ clear รอ network ที่ค้าง จะมีช่วงที่ผู้ใช้เดิมยังเป็น active identity อยู่ และถ้า
    // ล็อกอินโปรไฟล์ใหม่ในช่วงนั้น selectUser(null) ที่มาทีหลังจะล้าง session ใหม่ทิ้ง
    selectUser(null);
    // cookie เป็น HttpOnly จึงลบจากฝั่ง client ไม่ได้ ต้องให้ endpoint ล้างให้ (ปิดช่องที่ B1 เปิดค้างไว้)
    // ล้มเหลวทาง network ก็ไม่กระทบ state ฝั่ง client ที่ล้างไปแล้ว — อย่างมากคือ cookie ค้างจนหมดอายุเอง
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('เรียก /api/auth/logout ไม่สำเร็จ — ล้าง session ฝั่ง client แล้ว', err);
    }
  }, [selectUser]);

  // ลงทะเบียน handler กลาง: ทุก 401/403 จาก apiUtils.jsonFetch จะเด้งกลับไปหน้าเลือกโปรไฟล์
  // ไม่เรียก logout() (ซึ่งจะยิง /api/auth/logout ซ้ำโดยไม่จำเป็น) — แค่ล้าง state แล้ว redirect
  useEffect(() => {
    setSessionInvalidHandler(() => {
      selectUser(null);
      if (router.pathname !== '/profiles') {
        router.push('/profiles');
      }
    });
    return () => setSessionInvalidHandler(null);
  }, [selectUser, router]);

  const value = {
    currentUser,
    isReady,
    selectUser,
    logout,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};
