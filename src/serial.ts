declare global {
  interface Navigator { serial: any }
  type SerialPort = any;
}
export {};

export async function getOrRequestPort(opts: { prompt: boolean }): Promise<SerialPort | null> {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial is not available in this browser');
  }
  // The toolbar popup can't host the Web Serial picker (Chrome rejects with
  // NotFoundError without rendering it), so the prompt path is owned by the
  // dedicated connect tab. Here we only ever return previously-granted ports.
  // Prefer the most-recently-granted port — the connect tab forgets old ports
  // after a successful re-pick, but this is defensive in case forget() failed.
  const existing = await navigator.serial.getPorts();
  if (existing.length > 0) return existing[existing.length - 1];
  // opts.prompt is honoured by the connect tab, not here. Return null either way.
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
