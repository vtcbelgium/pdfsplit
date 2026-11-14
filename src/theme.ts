// Theme & Accessibility Preference Manager for Sovereign Fleet
export function initTheme(): void {
  const saved = localStorage.getItem('othrys-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = saved || (prefersDark ? 'dark' : 'light');
  document.body.setAttribute('data-theme', initialTheme);

  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-theme', next);
      localStorage.setItem('othrys-theme', next);
    });
  }

  const contrastToggle = document.getElementById('pref-high-contrast') as HTMLInputElement | null;
  const highContrast = localStorage.getItem('othrys-high-contrast') === 'true';
  document.body.setAttribute('data-contrast', highContrast ? 'high' : 'normal');
  if (contrastToggle) {
    contrastToggle.checked = highContrast;
    contrastToggle.addEventListener('change', () => {
      const enabled = contrastToggle.checked;
      document.body.setAttribute('data-contrast', enabled ? 'high' : 'normal');
      localStorage.setItem('othrys-high-contrast', String(enabled));
    });
  }

  const motionToggle = document.getElementById('pref-reduced-motion') as HTMLInputElement | null;
  const savedMotion = localStorage.getItem('othrys-reduced-motion');
  const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reducedMotion = savedMotion !== null ? savedMotion === 'true' : systemReduced;
  document.body.setAttribute('data-motion', reducedMotion ? 'reduced' : 'normal');
  if (motionToggle) {
    motionToggle.checked = reducedMotion;
    motionToggle.addEventListener('change', () => {
      const enabled = motionToggle.checked;
      document.body.setAttribute('data-motion', enabled ? 'reduced' : 'normal');
      localStorage.setItem('othrys-reduced-motion', String(enabled));
    });
  }
}
