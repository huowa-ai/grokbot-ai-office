import '@xterm/xterm/css/xterm.css';

import { ConnectionError, streamOffice } from './connect/session.js';
import { createOfficeView } from './render/view.js';
import { cuesUntil, demoDurationMs, demoScript } from './scene/demo.js';
import { parseClientEvent } from './scene/events.js';
import { statusLabel } from './scene/labels.js';
import { friendlyName, parseNameMap } from './scene/names.js';
import {
  createLinkState,
  noteConnectFailure,
  noteConnectStart,
  noteConnectSuccess,
  noteDemo,
  noteStop,
  readSession,
  sanitizeServerUrl,
  stripTokenFromSearch,
  writeSession,
} from './scene/reconnect.js';
import {
  type OfficeStateSnapshot,
  type SceneState,
  applyEvent,
  applySnapshot,
  createSceneState,
  listAgents,
  setFocus,
  tickScene,
} from './scene/state.js';
import { parseStyleCatalog } from './styles/catalog.js';
import { createHud } from './ui/hud.js';
import './style.css';

const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

async function main(): Promise<void> {
  const boot = new URLSearchParams(window.location.search);
  const demo = boot.get('demo') === '1';
  const stripped = stripTokenFromSearch(window.location.search);
  if (stripped.hadToken) {
    const next = `${window.location.pathname}${stripped.search}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  }

  const root = document.querySelector('#app');
  if (!(root instanceof HTMLElement)) {
    throw new Error('缺少 #app');
  }
  const names = parseNameMap(await loadOptional('/names.json'));
  const catalog = parseStyleCatalog(await loadOptional('/office-styles.json'));
  const view = createOfficeView(root);
  const hud = createHud(demo);
  let state = createSceneState();
  let focused: string | undefined;
  let link = demo ? noteDemo() : createLinkState();
  hud.setLink(link.phase, demo ? '脚本事件，不连接真实服务' : '');

  const session = readSession(window.sessionStorage);
  hud.setForm(session.origin, session.token);
  let origin = session.origin;
  let token = session.token;
  let liveAbort: AbortController | undefined;

  const syncFocus = (): void => {
    const next = state.focus;
    if (next === focused) {
      return;
    }
    focused = next;
    view.setFocus(next);
    const agent = next ? state.byId[next] : undefined;
    hud.setFocused(agent ? friendlyName(agent.provider, agent.host, names) : undefined);
  };

  let rosterKey = '';
  const publish = (): void => {
    const rows = listAgents(state).map((agent) => ({
      instance: agent.instance,
      label: friendlyName(agent.provider, agent.host, names),
      status: statusLabel(agent.status),
      code: agent.status,
    }));
    const key = rows.map((row) => `${row.instance}:${row.label}:${row.code}`).join('|');
    if (key !== rosterKey) {
      rosterKey = key;
      hud.setAgents(rows);
    }
    syncFocus();
  };

  hud.onPick((instance) => {
    state = setFocus(state, instance);
    publish();
  });
  root.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element) || event.target.tagName !== 'CANVAS') {
      return;
    }
    state = setFocus(state, view.pick(event.clientX, event.clientY));
    publish();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      state = setFocus(state, undefined);
      publish();
    }
  });
  window.addEventListener('resize', () => view.resize());

  const player = demo ? createDemoPlayer() : undefined;
  if (!demo) {
    hud.onSubmit((nextOrigin, nextToken) => {
      const clean = sanitizeServerUrl(nextOrigin);
      if (!clean) {
        hud.setLink(link.phase, '地址需要是 http 或 https');
        return;
      }
      const saved = writeSession(window.sessionStorage, { origin: clean, token: nextToken });
      origin = saved.origin;
      token = saved.token;
      link = noteStop(link);
      liveAbort?.abort();
      link = createLinkState();
      startLive();
    });
    hud.onStop(() => {
      link = noteStop(link);
      liveAbort?.abort();
      hud.setLink('stopped', origin);
    });
    startLive();
  }

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (player) {
      state = player.advance(state, dt * 1000, motion.matches);
    } else {
      state = tickScene(state, dt * 1000, { reducedMotion: motion.matches });
    }
    view.frame(state, catalog, names, dt, motion.matches);
    publish();
    requestAnimationFrame(frame);
  };
  view.resize();
  requestAnimationFrame(frame);

  function startLive(): void {
    liveAbort?.abort();
    const controller = new AbortController();
    liveAbort = controller;
    void runLive(controller.signal);
  }

  async function runLive(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && link.phase !== 'stopped' && link.phase !== 'demo') {
      link = noteConnectStart(link);
      hud.setLink(link.phase, origin);
      try {
        await streamOffice({
          origin,
          token,
          signal,
          onOpen: () => {
            link = noteConnectSuccess(link);
            hud.setLink('live', origin);
          },
          onSnapshot: (value) => {
            state = applySnapshot(state, asSnapshot(value));
            publish();
          },
          onEvent: (value) => {
            const event = parseClientEvent(value);
            if (!event) {
              return;
            }
            state = applyEvent(state, event);
          },
        });
        if (signal.aborted || link.phase === 'stopped') {
          return;
        }
        link = noteConnectFailure(link);
        hud.setLink(link.phase, '连接已断开');
        await wait(link.nextDelayMs, signal);
      } catch (error) {
        if (signal.aborted || link.phase === 'stopped') {
          return;
        }
        link = noteConnectFailure(link);
        hud.setLink(link.phase, failureText(error));
        await wait(link.nextDelayMs, signal);
      }
    }
  }
}

function createDemoPlayer(): {
  advance(state: SceneState, dtMs: number, reduced: boolean): SceneState;
} {
  const script = demoScript();
  const duration = demoDurationMs(script);
  let elapsed = 0;
  let cursor = 0;
  return {
    advance(previous, dtMs, reduced) {
      elapsed += dtMs;
      let next = previous;
      if (elapsed >= duration) {
        elapsed = 0;
        cursor = 0;
        next = createSceneState();
      }
      const step = cuesUntil(script, elapsed, cursor);
      cursor = step.cursor;
      for (const event of step.events) {
        next = applyEvent(next, event);
      }
      return tickScene(next, dtMs, { reducedMotion: reduced });
    },
  };
}

function asSnapshot(value: unknown): OfficeStateSnapshot {
  if (typeof value !== 'object' || value === null || !('instances' in value)) {
    return { instances: [] };
  }
  const instances = (value as { instances?: unknown }).instances;
  return {
    instances: Array.isArray(instances) ? (instances as OfficeStateSnapshot['instances']) : [],
  };
}

function failureText(error: unknown): string {
  if (error instanceof ConnectionError && error.kind === 'unauthorized') {
    return '令牌不正确';
  }
  return '无法连接事件服务';
}

async function loadOptional(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return undefined;
    }
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return undefined;
    }
    throw error;
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

void main();
