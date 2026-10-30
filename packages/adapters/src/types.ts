export type CliInput = 'stdin' | 'arg' | 'file';

export interface SubscriptionConfig {
  auth: 'subscription';
  command: readonly string[];
  input?: CliInput;
  safe_mode: string;
  output_filter?: string;
  hosts?: readonly string[];
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

export interface AdapterRuntime {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  workspace?: string;
  homeDirectory?: string;
}
