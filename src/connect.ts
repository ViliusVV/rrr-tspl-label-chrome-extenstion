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
    await navigator.serial.requestPort();
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
