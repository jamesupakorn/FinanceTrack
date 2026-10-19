import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

const midnightColors = {
  bgColor: '#03081a',
  bgPrimary: '#03081a',
  bgSurface: 'rgba(15, 18, 40, 0.92)',
  bgSurfaceAlt: 'rgba(21, 26, 56, 0.88)',
  surfaceColor: 'rgba(15, 18, 40, 0.92)',
  surfaceAltColor: 'rgba(21, 26, 56, 0.88)',
  textPrimary: '#f8fbff',
  textSecondary: '#c7cffc',
  textLight: '#8e96c9',
  borderColor: 'rgba(255, 255, 255, 0.16)',
  borderLight: 'rgba(255, 255, 255, 0.08)',
  colorPrimary: '#5d5bff',
  primaryColor: '#5d5bff',
  secondaryColor: '#4df0c3',
  dangerColor: '#ff7aa2',
  warningColor: '#facc6b',
  infoColor: '#4ecbff',
  gradientPrimary: 'linear-gradient(135deg, #5d5bff 0%, #00d4ff 100%)',
  gradientSecondary: 'linear-gradient(135deg, #4df0c3 0%, #4ecbff 100%)',
  shadowColor: 'rgba(2, 6, 23, 0.55)',
  shadowSm: 'rgba(2, 6, 23, 0.45)',
  shadowMedium: 'rgba(2, 6, 23, 0.55)',
  shadowMd: 'rgba(2, 6, 23, 0.6)',
  shadowStrong: 'rgba(2, 6, 23, 0.72)'
};

const DEFAULT_THEME = 'midnight' as const;
type ThemeName = typeof DEFAULT_THEME;

interface ThemeDefinition {
  name: string;
  colors: typeof midnightColors;
}

const themes: Record<ThemeName, ThemeDefinition> = {
  midnight: {
    name: 'Midnight Glass',
    colors: midnightColors
  }
};

interface ThemeContextValue {
  currentTheme: ThemeName;
  theme: ThemeDefinition;
  themes: typeof themes;
  switchTheme: (themeName: string) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [currentTheme, setCurrentTheme] = useState<ThemeName>(DEFAULT_THEME);

  // โหลดธีมจาก localStorage เมื่อเริ่มต้น
  useEffect(() => {
    const savedTheme = localStorage.getItem('financetrack-theme');
    if (savedTheme && themes[savedTheme as ThemeName]) {
      setCurrentTheme(savedTheme as ThemeName);
    } else {
      setCurrentTheme(DEFAULT_THEME);
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

  const switchTheme = (themeName: string) => {
    if (themes[themeName as ThemeName]) {
      setCurrentTheme(themeName as ThemeName);
    }
  };

  const toggleTheme = () => {
    const themeKeys = Object.keys(themes) as ThemeName[];
    const currentIndex = themeKeys.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themeKeys.length;
    setCurrentTheme(themeKeys[nextIndex]);
  };

  const theme = themes[currentTheme];

  const value: ThemeContextValue = {
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