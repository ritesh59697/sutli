import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const KEY = "sutli.theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
  }, [theme]);
  const next: Theme = theme === "light" ? "dark" : "light";
  const flip = () => {
    setTheme(next);
    try { localStorage.setItem(KEY, next); } catch { /* storage unavailable: theme still switches for this visit */ }
  };
  return (
    <button className="btn icon-btn" onClick={flip} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === "light" ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
    </button>
  );
}
