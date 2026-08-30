import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { setActiveUserId } from '../../shared/utils/frontend/sessionClient';
import { withApiTokenHeaders } from '../../shared/utils/frontend/apiToken';

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
  const [currentUser, setCurrentUser] = useState(null);
  const [isReady, setIsReady] = useState(false);

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
      // ต้องแนบ Bearer token เพราะ endpoint นี้ผ่าน assertApiToken (TD-H05)
      fetch(`/api/user-bank-accounts?userId=${encodeURIComponent(user.id)}`, {
        headers: withApiTokenHeaders()
      })
        .then(res => res.json())
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

  const logout = useCallback(() => {
    selectUser(null);
  }, [selectUser]);

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
