"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";
const storageKey = "nautilus-theme-v1";
const changeEvent = "nautilus-theme-change";

function getTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}

function subscribe(callback: () => void) {
  window.addEventListener(changeEvent, callback);
  return () => window.removeEventListener(changeEvent, callback);
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  window.dispatchEvent(new Event(changeEvent));
}

export function ThemeController() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystem = () => applyTheme(getTheme());
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const value = event.newValue;
      applyTheme(value === "light" || value === "dark" ? value : "system");
    };
    updateSystem();
    media.addEventListener("change", updateSystem);
    window.addEventListener("storage", syncStorage);
    return () => {
      media.removeEventListener("change", updateSystem);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);
  return null;
}

const options = [
  { value: "light", label: "Light", description: "A bright, clear workspace.", Icon: Sun },
  { value: "dark", label: "Dark", description: "A softer view in low light.", Icon: Moon },
  { value: "system", label: "System", description: "Match your device settings.", Icon: Monitor },
] as const;

export function ThemeSettings() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "system" as Theme);
  return (
    <section className="settings-panel appearance-panel" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">Appearance</h2>
      <p>Make this workspace feel like yours. Choose how Nautilus looks on this device.</p>
      <fieldset className="theme-options">
        <legend className="sr-only">Color mode</legend>
        {options.map(({ value, label, description, Icon }) => (
          <label key={value} className="theme-option" data-selected={theme === value}>
            <input type="radio" name="color-mode" value={value} checked={theme === value} onChange={() => {
              applyTheme(value);
              try { localStorage.setItem(storageKey, value); } catch { /* Keep the selection for this visit if storage is unavailable. */ }
            }} />
            <Icon size={24} aria-hidden="true" />
            <strong>{label}</strong>
            <span>{description}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs">Changes apply immediately. Your preference is saved in this browser when storage is available.</p>
    </section>
  );
}
