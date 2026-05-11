const btn = document.getElementById('pick') as HTMLButtonElement;
const msg = document.getElementById('msg') as HTMLParagraphElement;

function setMsg(text: string, kind: 'ok' | 'error' | '' = ''): void {
  msg.textContent = text;
  msg.classList.remove('ok', 'error');
  if (kind) msg.classList.add(kind);
}

// Captured at load so the click handler can do its work without an intervening await.
let previouslyGranted: SerialPort[] = [];
navigator.serial.getPorts().then((p) => {
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
    setMsg('Connected. Closing tab…', 'ok');
    setTimeout(() => {
      try {
        window.close();
      } catch {
        setMsg('Connected. You can close this tab.', 'ok');
      }
    }, 900);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err.name === 'NotFoundError') {
      setMsg('No port selected. Click "Pick port" to try again.', 'error');
    } else {
      setMsg(`${err.name ?? 'Error'}: ${err.message ?? String(e)}`, 'error');
    }
    btn.disabled = false;
  }
});

btn.focus();
