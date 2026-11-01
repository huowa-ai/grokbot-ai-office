import type { AgentStatus } from './events.js';

export function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'working':
      return '工作中';
    case 'stuck':
      return '卡住';
    case 'waiting_approval':
      return '待批准';
    case 'handoff':
      return '交接';
    case 'idle':
      return '空闲';
    default:
      return '刚到';
  }
}
