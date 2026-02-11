import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { setActiveUserId } from '../../shared/utils/frontend/sessionClient';

const STORAGE_KEY = 'financetrack-current-user';

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
    } catch (err) {
      console.error('โหลดข้อมูลผู้ใช้จาก localStorage ไม่สำเร็จ', err);
    } finally {
      setIsReady(true);
    }
  }, []);

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
