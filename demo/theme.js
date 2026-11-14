// The page's theme switch. System (the default) leaves <html> alone and the threads follow
// prefers-color-scheme; Light and Dark set <html data-theme>, which every thread with
// theme: 'auto' and the demo's own colors follow, with CSS only. A classic script in <head>,
// so a remembered choice is on the page before its first paint, with no flash.
(() => {
  const KEY = 'chat-thread-demo-theme';
  const html = document.documentElement;
  const read = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };
  const remember = (scheme) => {
    try {
      if (scheme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, scheme);
    } catch { /* storage blocked: the choice lasts until the page closes */ }
  };
  const apply = (scheme) => {
    if (scheme === 'light' || scheme === 'dark') html.dataset.theme = scheme;
    else delete html.dataset.theme;
  };

  apply(read());
  document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('[data-scheme]');
    const press = (scheme) => { for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.scheme === scheme)); };
    press(html.dataset.theme || 'system');
    for (const button of buttons) {
      button.addEventListener('click', () => {
        apply(button.dataset.scheme);
        remember(button.dataset.scheme);
        press(button.dataset.scheme);
      });
    }
  });
})();
