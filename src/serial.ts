declare global {
  interface Navigator { serial: any }
  type SerialPort = any;
}
export {};

export async function getOrRequestPort(opts: { prompt: boolean }): Promise<SerialPort | null> {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial is not available in this browser');
  }
  const existing = await navigator.serial.getPorts();
  if (existing.length > 0) return existing[0];
  if (!opts.prompt) return null;
  try {
    return await navigator.serial.requestPort();
  } catch {
    // User dismissed the picker.
    return null;
  }
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
