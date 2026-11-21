/** OWNER: D. Light/dark theme shared by the main window and the overlay. */
export type Theme = 'light' | 'dark'
const KEY = 'tap-theme'

export function currentTheme(): Theme {
  const saved = localStorage.getItem(KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function setTheme(t: Theme): void {
  localStorage.setItem(KEY, t)
  document.documentElement.dataset.theme = t
}

export function toggleTheme(): void {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark')
}

/** Apply the saved (or OS) theme; the 'storage' event keeps the other window in sync. */
export function initTheme(): void {
  document.documentElement.dataset.theme = currentTheme()
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) document.documentElement.dataset.theme = currentTheme()
  })
}
