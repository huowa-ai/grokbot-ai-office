export type LinkPhase = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'stopped' | 'demo';

export interface LinkState {
  phase: LinkPhase;
  attempt: number;
  nextDelayMs: number;
}

const BASE_MS = 500;
const MAX_MS = 15_000;

const TOKEN_QUERY_KEYS = new Set(['token', 'access_token', 'relay_token', 'relay_server_token']);

export function createLinkState(): LinkState {
  return { phase: 'idle', attempt: 0, nextDelayMs: 0 };
}

export function noteConnectStart(state: LinkState): LinkState {
  if (state.phase === 'stopped' || state.phase === 'demo') {
    return state;
  }
  return { ...state, phase: 'connecting' };
}

export function noteConnectSuccess(state: LinkState): LinkState {
  if (state.phase === 'stopped' || state.phase === 'demo') {
    return state;
  }
  return { phase: 'live', attempt: 0, nextDelayMs: 0 };
}

export function noteConnectFailure(state: LinkState, random: () => number = () => 0): LinkState {
  if (state.phase === 'stopped' || state.phase === 'demo') {
    return state;
  }
  const attempt = state.attempt + 1;
  return { phase: 'reconnecting', attempt, nextDelayMs: backoffMs(attempt, random) };
}

export function noteStop(state: LinkState): LinkState {
  if (state.phase === 'stopped') {
    return state;
  }
  return { phase: 'stopped', attempt: 0, nextDelayMs: 0 };
}

export function noteDemo(): LinkState {
  return { phase: 'demo', attempt: 0, nextDelayMs: 0 };
}

export function backoffMs(attempt: number, random: () => number = () => 0): number {
  const step = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(MAX_MS, BASE_MS * 2 ** (step - 1));
  const unit = Math.min(1, Math.max(0, random()));
  const jitter = exponential * 0.2 * unit;
  return Math.round(Math.min(MAX_MS, exponential + jitter));
}

export function stripTokenFromSearch(search: string): { search: string; hadToken: boolean } {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  let hadToken = false;
  for (const key of [...params.keys()]) {
    if (TOKEN_QUERY_KEYS.has(key.toLowerCase())) {
      params.delete(key);
      hadToken = true;
    }
  }
  const next = params.toString();
  return { search: next.length > 0 ? `?${next}` : '', hadToken };
}

export function sanitizeServerUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return undefined;
  }
  url.searchParams.delete('token');
  url.searchParams.delete('access_token');
  url.hash = '';
  return url.origin;
}

export function eventUrls(origin: string, token?: string): { state: string; socket: string } {
  const url = new URL(origin);
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new URL(`${wsProtocol}//${url.host}/events`);
  if (token && token.length > 0) {
    socket.searchParams.set('token', token);
  }
  return { state: `${url.origin}/state`, socket: socket.toString() };
}

export interface SessionConfig {
  origin: string;
  token: string;
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const URL_KEY = 'grokbot.office.serverUrl';
const TOKEN_KEY = 'grokbot.office.token';

export function readSession(storage: SessionStorageLike): SessionConfig {
  const stored = storage.getItem(URL_KEY);
  const origin = sanitizeServerUrl(stored ?? '') ?? 'http://127.0.0.1:8787';
  const token = storage.getItem(TOKEN_KEY) ?? '';
  return { origin, token };
}

export function writeSession(storage: SessionStorageLike, config: SessionConfig): SessionConfig {
  const origin = sanitizeServerUrl(config.origin) ?? 'http://127.0.0.1:8787';
  storage.setItem(URL_KEY, origin);
  if (config.token.trim().length === 0) {
    storage.removeItem(TOKEN_KEY);
    return { origin, token: '' };
  }
  storage.setItem(TOKEN_KEY, config.token);
  return { origin, token: config.token };
}
