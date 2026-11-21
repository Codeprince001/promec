'use client';

import { Moon, Sun } from 'lucide-react';

const storageKey = 'promec-theme';

export function ThemeToggle() {
  function toggle() {
    const dark = document.documentElement.classList.toggle('dark');
    localStorage.setItem(storageKey, dark ? 'dark' : 'light');
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch color mode"
      className="inline-flex size-11 items-center justify-center rounded-full text-on-header/80 hover:bg-on-header/10 hover:text-on-header"
    >
      <Moon className="size-5 dark:hidden" aria-hidden />
      <Sun className="hidden size-5 dark:block" aria-hidden />
    </button>
  );
}
