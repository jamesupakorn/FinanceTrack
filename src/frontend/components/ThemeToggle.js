import { useTheme } from '../contexts/ThemeContext';
import { Icons } from './Icons';
import styles from '../styles/ThemeToggle.module.css';

const ThemeToggle = () => {
  const { currentTheme, themes, switchTheme, toggleTheme } = useTheme();

  const getThemeIcon = (themeName) => {
    switch (themeName) {
      case 'light':
        return <Icons.Sun size={18} color="white" />;
      case 'dark':
        return <Icons.Moon size={18} color="white" />;
      case 'financial':
        return <Icons.DollarSign size={18} color="white" />;
      default:
        return <Icons.Settings size={18} color="white" />;
    }
  };

  const getThemeLabel = (themeName) => {
    return themes[themeName]?.name || themeName;
  };

  // No number/money input fields; only theme selector
  return (
    <div className={styles.themeToggle}>
      <select
        value={currentTheme}
        onChange={(e) => switchTheme(e.target.value)}
        className={styles.themeSelector}
      >
        {Object.entries(themes).map(([key, theme]) => (
          <option 
            key={key} 
            value={key}
            className={styles.themeOption}
          >
            {theme.name}
          </option>
        ))}
      </select>
      {/* Theme Icon Overlay */}
      <div className={styles.themeIconOverlay}>
        {getThemeIcon(currentTheme)}
      </div>
    </div>
  );
};

export default ThemeToggle;