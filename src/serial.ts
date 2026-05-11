declare global {
  interface Navigator { serial: any }
  type SerialPort = any;
}
export {};

export async function getCurrentPort(): Promise<SerialPort | null> {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial is not available in this browser');
  }
  // The Web Serial picker can't be hosted from the toolbar popup (Chrome rejects
  // it with NotFoundError without rendering UI), so the prompt flow is owned by
  // the dedicated connect tab. This function only looks up already-granted ports.
  // Prefer the most-recently-granted port — the connect tab forgets old ports
  // after a successful re-pick, but this is defensive in case forget() failed.
  const existing = await navigator.serial.getPorts();
  if (existing.length > 0) return existing[existing.length - 1];
  return null;
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
