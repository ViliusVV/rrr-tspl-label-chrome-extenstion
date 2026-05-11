declare global {
  interface Navigator { serial: any }
  type SerialPort = any;
}
export {};

export async function getOrRequestPort(opts: { prompt: boolean }): Promise<SerialPort | null> {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial is not available in this browser');
  }
  if (opts.prompt) {
    // Call requestPort synchronously after the user click — no intervening awaits.
    // Awaiting getPorts() first can invalidate the transient user activation in MV3
    // popups, causing requestPort to reject with NotAllowedError without showing the
    // picker. Skip the getPorts() pre-check on the explicit-prompt path entirely.
    try {
      return await navigator.serial.requestPort();
    } catch (e) {
      const err = e as { name?: string; message?: string };
      // User cancelled the picker — silent null.
      if (err.name === 'NotFoundError') return null;
      // Anything else (NotAllowedError, SecurityError, etc.) is a real failure —
      // surface it so the popup status can show what actually broke.
      console.warn('navigator.serial.requestPort rejected:', e);
      throw e;
    }
  }
  const existing = await navigator.serial.getPorts();
  return existing.length > 0 ? existing[0] : null;
}

export async function sendBytes(
  port: SerialPort,
  baudRate: number,
  bytes: Uint8Array,
): Promise<void> {
  await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  try {
    const writer = port.writable!.getWriter();
    try {
      await writer.write(bytes);
      await writer.ready;
    } finally {
      writer.releaseLock();
    }
  } finally {
    await port.close();
  }
}
