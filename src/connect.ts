const btn = document.getElementById('pick') as HTMLButtonElement;
const msg = document.getElementById('msg') as HTMLParagraphElement;

function setMsg(text: string, kind: 'ok' | 'error' | '' = ''): void {
  msg.textContent = text;
  msg.classList.remove('ok', 'error');
  if (kind) msg.classList.add(kind);
}

btn.addEventListener('click', async () => {
  setMsg('');
  btn.disabled = true;
  try {
    const port = await navigator.serial.requestPort();
    console.log('[connect] port granted:', port);
    setMsg('Connected. Closing window…', 'ok');
    setTimeout(() => window.close(), 1200);
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
