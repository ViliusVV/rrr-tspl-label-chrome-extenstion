import { applyI18nToDom, setLang, t } from './i18n';
import { loadSettings } from './settings';

const btn = document.getElementById('pick') as HTMLButtonElement;
const msg = document.getElementById('msg') as HTMLParagraphElement;

function setMsg(text: string, kind: 'ok' | 'error' | '' = ''): void {
  msg.textContent = text;
  msg.classList.remove('ok', 'error');
  if (kind) msg.classList.add(kind);
}

// Captured at load so the click handler can do its work without an intervening await.
// SerialPort isn't reliably typed in lib.dom, so use any[] here.
let previouslyGranted: any[] = [];
navigator.serial.getPorts().then((p: any[]) => {
  previouslyGranted = p;
});

btn.addEventListener('click', async () => {
  setMsg('');
  btn.disabled = true;
  try {
    const newPort = await navigator.serial.requestPort();
    // Revoke permission on any previously-granted ports that aren't the newly-picked
    // one, so we don't accumulate zombie grants across re-picks.
    for (const old of previouslyGranted) {
      if (old !== newPort) {
        try {
          await old.forget();
        } catch (e) {
          console.warn('[connect] forget() failed for stale port:', e);
        }
      }
    }
    setMsg(t('connect_success'), 'ok');
    setTimeout(() => {
      try {
        window.close();
      } catch {
        setMsg(t('connect_success_no_close'), 'ok');
      }
    }, 900);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err.name === 'NotFoundError') {
      setMsg(t('connect_cancelled'), 'error');
    } else {
      setMsg(`${err.name ?? 'Error'}: ${err.message ?? String(e)}`, 'error');
    }
    btn.disabled = false;
  }
});

btn.focus();

// Apply the saved language to this page's static text. If load fails, falls back to
// the default 'en'.
loadSettings()
  .then((s) => {
    setLang(s.language);
    applyI18nToDom();
  })
  .catch(() => {
    applyI18nToDom();
  });
