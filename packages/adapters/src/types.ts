export type CliInput = 'stdin' | 'arg' | 'file';

export interface SubscriptionConfig {
  auth: 'subscription';
  command: readonly string[];
  input?: CliInput;
  safe_mode: string;
  output_filter?: string;
  hosts?: readonly string[];
  pty?: boolean;
}

export interface ApiKeyConfig {
  auth: 'api_key';
  vendor?: string;
  model?: string;
  key_env: string;
  hosts?: readonly string[];
}

export interface OpenAiCompatibleConfig {
  auth: 'openai_compatible';
  base_url: string;
  model: string;
  key_env?: string | null;
  hosts?: readonly string[];
}

export type AdapterConfig = SubscriptionConfig | ApiKeyConfig | OpenAiCompatibleConfig;

export interface PtyProcess {
  pid: number;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export type PtySpawn = (file: string, args: string[], options: PtySpawnOptions) => PtyProcess;

export interface AdapterRuntime {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  workspace?: string;
  homeDirectory?: string;
  ptySpawn?: PtySpawn;
  loadPty?: () => Promise<PtySpawn | undefined>;
  killTree?: (pid: number) => void;
  log?: (message: string) => void;
}
