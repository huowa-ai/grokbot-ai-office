export const MAX_LIVE_TERMINALS = 4;

export interface TerminalCandidate {
  instance: string;
  visible: boolean;
}

export function chooseTerminals(
  candidates: readonly TerminalCandidate[],
  focus: string | undefined,
): string[] {
  const ranked = [...candidates].sort((left, right) => {
    const score = (item: TerminalCandidate): number => {
      if (item.instance === focus) {
        return 0;
      }
      return item.visible ? 1 : 2;
    };
    const delta = score(left) - score(right);
    if (delta !== 0) {
      return delta;
    }
    return left.instance.localeCompare(right.instance);
  });
  return ranked.slice(0, MAX_LIVE_TERMINALS).map((item) => item.instance);
}
