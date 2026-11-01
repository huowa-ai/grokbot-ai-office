import { eventUrls } from '../scene/reconnect.js';

export class ConnectionError extends Error {
  readonly kind: 'unauthorized' | 'http' | 'closed' | 'socket' | 'bad-json';
  readonly status: number;

  constructor(kind: ConnectionError['kind'], status = 0) {
    super(kind);
    this.name = 'ConnectionError';
    this.kind = kind;
    this.status = status;
  }
}

export async function streamOffice(options: {
  origin: string;
  token: string;
  signal: AbortSignal;
  onOpen: () => void;
  onSnapshot: (value: unknown) => void;
  onEvent: (value: unknown) => void;
}): Promise<void> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.token.length > 0) {
    headers.authorization = `Bearer ${options.token}`;
  }
  let response: Response;
  try {
    response = await fetch(`${options.origin}/state`, { headers, signal: options.signal });
  } catch (error) {
    if (options.signal.aborted) {
      return;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }
    throw error instanceof Error ? error : new ConnectionError('socket');
  }
  if (options.signal.aborted) {
    return;
  }
  if (!response.ok) {
    throw new ConnectionError(response.status === 401 ? 'unauthorized' : 'http', response.status);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConnectionError('bad-json', response.status);
    }
    throw error;
  }
  options.onSnapshot(body);
  if (options.signal.aborted) {
    return;
  }

  const urls = eventUrls(options.origin, options.token.length > 0 ? options.token : undefined);
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(urls.socket);
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      if (error && !options.signal.aborted) {
        reject(error);
        return;
      }
      resolve();
    };
    options.signal.addEventListener('abort', () => finish(), { once: true });
    socket.addEventListener('open', () => {
      options.onOpen();
    });
    socket.addEventListener('message', (message) => {
      try {
        options.onEvent(JSON.parse(String(message.data)) as unknown);
      } catch (error) {
        if (error instanceof SyntaxError) {
          return;
        }
        finish(error instanceof Error ? error : new ConnectionError('bad-json'));
      }
    });
    socket.addEventListener('close', () => {
      finish(options.signal.aborted ? undefined : new ConnectionError('closed'));
    });
    socket.addEventListener('error', () => {
      finish(new ConnectionError('socket'));
    });
  });
}
