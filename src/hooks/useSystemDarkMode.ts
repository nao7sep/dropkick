import { useEffect, useState } from "react";
import { SYSTEM_DARK_THEME_QUERY, systemPrefersDark } from "../utils/theme";

export function useSystemDarkMode(): boolean {
  const [darkMode, setDarkMode] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(SYSTEM_DARK_THEME_QUERY);
    const sync = () => setDarkMode(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return darkMode;
}
