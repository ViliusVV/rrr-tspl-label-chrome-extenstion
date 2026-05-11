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
    // Diagnostic logging — remove once Connect works end-to-end.
    console.log('[serial] calling navigator.serial.requestPort');
    try {
      const port = await navigator.serial.requestPort();
      console.log('[serial] requestPort resolved with port:', port);
      return port;
    } catch (e) {
      const err = e as { name?: string; message?: string };
      console.log('[serial] requestPort rejected — name:', err.name, '| message:', err.message);
      if (err.name === 'NotFoundError') return null;
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
