function detectOS() {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

function showCTA() {
  const os = detectOS();
  const map = {
    windows: 'win-cta',
    mac: 'mac-cta',
    linux: 'linux-cta',
    unknown: 'unknown-cta'
  };
  const id = map[os] || 'unknown-cta';
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function copyCmd(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const btn = el.parentElement.querySelector('.copy-btn');
    if (btn) {
      btn.textContent = 'copied';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'copy';
        btn.classList.remove('copied');
      }, 2000);
    }
  });
}

showCTA();
