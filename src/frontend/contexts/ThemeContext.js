import { createContext, useContext, useState, useEffect } from 'react';

// ธีมที่ปรับใหม่ให้สบายตา
const themes = {
  light: {
    name: 'สว่าง',
    colors: {
      // พื้นฐาน - โทนสว่างอ่อนนุ่ม
      background: '#fafbfc',
      surface: '#ffffff',
      surfaceAlt: '#f6f8fa',
      
      // ข้อความ - โทนเทาอ่อน
      textPrimary: '#24292f',
      textSecondary: '#656d76',
      textLight: '#8c959f',
      
      // เส้นขอบ - สีอ่อนละมุน
      border: '#d0d7de',
      borderLight: '#e6eaef',
      
      // สีหลัก - โทนสว่างสบายตา
      primary: '#0969da',      // น้ำเงินสว่าง
      secondary: '#1a7f37',    // เขียวสว่าง
      danger: '#cf222e',       // แดงสว่าง
      warning: '#d1242f',      // ส้มสว่าง
      info: '#218bff',         // ฟ้าสว่าง
      
      // การไล่สี
      gradientPrimary: 'linear-gradient(135deg, #0969da 0%, #218bff 100%)',
      gradientSecondary: 'linear-gradient(135deg, #1a7f37 0%, #2da44e 100%)',
      
      // เงา - อ่อนมาก
      shadow: 'rgba(27, 31, 35, 0.04)',
      shadowMedium: 'rgba(27, 31, 35, 0.08)',
      shadowStrong: 'rgba(27, 31, 35, 0.12)',
    }
  },
  
  dark: {
    name: 'มืด',
    colors: {
      // พื้นฐาน - โทนมืดทึบ
      background: '#0d1117',
      surface: '#161b22',
      surfaceAlt: '#21262d',
      
      // ข้อความ - สีขาวนุ่ม
      textPrimary: '#f0f6fc',
      textSecondary: '#8b949e',
      textLight: '#6e7681',
      
      // เส้นขอบ - เทาเข้ม
      border: '#30363d',
      borderLight: '#21262d',
      
      // สีหลัก - โทนมืดนุ่มตา
      primary: '#4493f8',      // น้ำเงินนุ่ม
      secondary: '#3fb950',    // เขียวนุ่ม
      danger: '#f85149',       // แดงนุ่ม
      warning: '#d29922',      // ส้มนุ่ม
      info: '#79c0ff',         // ฟ้านุ่ม
      
      // การไล่สี
      gradientPrimary: 'linear-gradient(135deg, #4493f8 0%, #79c0ff 100%)',
      gradientSecondary: 'linear-gradient(135deg, #3fb950 0%, #56d364 100%)',
      
      // เงา - เข้มแต่นุ่ม
      shadow: 'rgba(1, 4, 9, 0.8)',
      shadowMedium: 'rgba(1, 4, 9, 0.85)',
      shadowStrong: 'rgba(1, 4, 9, 0.9)',
    }
  },
  
  financial: {
    name: 'ไฟแนนโปร',
    colors: {
      // พื้นฐาน - โทนน้ำเงินสบายตา
      background: '#f0f4ff',
      surface: '#ffffff',
      surfaceAlt: '#f6f8ff',
      
      // ข้อความ - โทนน้ำเงินเข้ม
      textPrimary: '#0f1c3f',
      textSecondary: '#1f2937',
      textLight: '#6b7280',
      
      // เส้นขอบ - น้ำเงินอ่อน
      border: '#bfdbfe',
      borderLight: '#dbeafe',
      
      // สีหลัก - โทนน้ำเงินหลัก
      primary: '#1d4ed8',      // น้ำเงินหลัก
      secondary: '#0ea5e9',    // ฟ้าใส
      danger: '#dc2626',       // แดงเข้ม
      warning: '#d97706',      // ส้มเข้ม
      info: '#2563eb',         // น้ำเงินสว่าง
      
      // การไล่สี - โทนน้ำเงิน
      gradientPrimary: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)',
      gradientSecondary: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
      
      // เงา - น้ำเงินอ่อน
      shadow: 'rgba(29, 78, 216, 0.08)',
      shadowMedium: 'rgba(29, 78, 216, 0.12)',
      shadowStrong: 'rgba(29, 78, 216, 0.16)',
    }
  }
};

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState('light');

  // โหลดธีมจาก localStorage เมื่อเริ่มต้น
  useEffect(() => {
    const savedTheme = localStorage.getItem('financetrack-theme');
    if (savedTheme && themes[savedTheme]) {
      setCurrentTheme(savedTheme);
    }
  }, []);

  // บันทึกธีมลง localStorage และอัปเดต CSS variables เมื่อเปลี่ยน
  useEffect(() => {
    localStorage.setItem('financetrack-theme', currentTheme);
    
    // อัปเดต CSS variables
    const root = document.documentElement;
    const theme = themes[currentTheme];
    
    if (theme && theme.colors) {
      Object.entries(theme.colors).forEach(([key, value]) => {
        const cssVar = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        root.style.setProperty(`--${cssVar}`, value);
      });
    }
    
    // ตั้ง data-theme attribute สำหรับ CSS
    root.setAttribute('data-theme', currentTheme);
  }, [currentTheme]);

  const switchTheme = (themeName) => {
    if (themes[themeName]) {
      setCurrentTheme(themeName);
    }
  };

  const toggleTheme = () => {
    const themeKeys = Object.keys(themes);
    const currentIndex = themeKeys.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themeKeys.length;
    setCurrentTheme(themeKeys[nextIndex]);
  };

  const theme = themes[currentTheme];

  const value = {
    currentTheme,
    theme,
    themes,
    switchTheme,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeContext;