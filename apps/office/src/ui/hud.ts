import type { LinkPhase } from '../scene/reconnect.js';

export interface HudAgent {
  instance: string;
  label: string;
  status: string;
  code: string;
}

export interface OfficeHud {
  setLink(phase: LinkPhase, detail: string): void;
  setAgents(agents: readonly HudAgent[]): void;
  setFocused(label: string | undefined): void;
  setForm(origin: string, token: string): void;
  onPick(handler: (instance: string | undefined) => void): void;
  onSubmit(handler: (origin: string, token: string) => void): void;
  onStop(handler: () => void): void;
}

const PHASE_TEXT: Record<LinkPhase, string> = {
  idle: '未连接',
  connecting: '正在连接',
  live: '已连接',
  reconnecting: '正在重连',
  stopped: '已断开',
  demo: '演示',
};

export function createHud(demo: boolean): OfficeHud {
  const root = document.createElement('div');
  root.className = 'hud';

  const bar = document.createElement('div');
  bar.className = 'hud-bar';
  const title = document.createElement('div');
  title.className = 'hud-title';
  title.textContent = '办公室';
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.textContent = demo ? '演示' : '未连接';
  const detail = document.createElement('span');
  detail.className = 'hud-detail';
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.textContent = '连接';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'back';
  back.textContent = '返回总览';
  back.hidden = true;
  bar.append(title, pill, detail, back, settingsButton);

  const panel = document.createElement('form');
  panel.className = 'panel';
  panel.hidden = demo;
  const urlLabel = document.createElement('label');
  urlLabel.textContent = '事件服务';
  const urlInput = document.createElement('input');
  urlInput.name = 'origin';
  urlInput.type = 'url';
  urlInput.autocomplete = 'off';
  urlInput.spellcheck = false;
  urlInput.placeholder = 'http://127.0.0.1:8787';
  urlLabel.append(urlInput);
  const tokenLabel = document.createElement('label');
  tokenLabel.textContent = '令牌（可选）';
  const tokenInput = document.createElement('input');
  tokenInput.name = 'token';
  tokenInput.type = 'password';
  tokenInput.autocomplete = 'off';
  tokenInput.placeholder = '只保存在本次会话';
  tokenLabel.append(tokenInput);
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = '令牌只写入 sessionStorage，不会出现在地址栏里。';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const connect = document.createElement('button');
  connect.type = 'submit';
  connect.textContent = '连接';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.textContent = '断开';
  actions.append(connect, stop);
  panel.append(urlLabel, tokenLabel, note, actions);

  const list = document.createElement('div');
  list.className = 'roster';
  list.setAttribute('role', 'list');

  root.append(bar, panel, list);
  document.body.append(root);

  let pickHandler: (instance: string | undefined) => void = () => undefined;
  let submitHandler: (origin: string, token: string) => void = () => undefined;
  let stopHandler: () => void = () => undefined;

  settingsButton.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });
  back.addEventListener('click', () => {
    pickHandler(undefined);
  });
  stop.addEventListener('click', () => {
    stopHandler();
  });
  panel.addEventListener('submit', (event) => {
    event.preventDefault();
    submitHandler(urlInput.value, tokenInput.value);
    if (!demo) {
      panel.hidden = true;
    }
  });

  return {
    setLink(phase, text) {
      pill.textContent = PHASE_TEXT[phase];
      pill.dataset.phase = phase;
      detail.textContent = text;
    },
    setAgents(agents) {
      list.replaceChildren();
      for (const agent of agents) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'roster-item';
        button.dataset.status = agent.code;
        button.textContent = `${agent.label} · ${agent.status}`;
        button.addEventListener('click', () => {
          pickHandler(agent.instance);
        });
        list.append(button);
      }
    },
    setFocused(label) {
      back.hidden = label === undefined;
      back.textContent = label ? `返回总览 · ${label}` : '返回总览';
    },
    setForm(origin, token) {
      urlInput.value = origin;
      tokenInput.value = token;
    },
    onPick(handler) {
      pickHandler = handler;
    },
    onSubmit(handler) {
      submitHandler = handler;
    },
    onStop(handler) {
      stopHandler = handler;
    },
  };
}
