import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { createAdapter, resolveWorkspace } from '@grokbot-ai-office/adapters';
import {
  type AdapterPort,
  type EventSink,
  type InstanceDetail,
  type OfficeSnapshot,
  RelayError,
  type RelayEvent,
  formatInstance,
  handoff,
  listApprovals,
  readOutputChunkChars,
  readPromptPreviewChars,
  readStateChunkLimit,
  redactSecrets,
  reduceEvents,
  relay,
  requestApproval,
  resolveApproval,
} from '@grokbot-ai-office/core';
import { createJsonlEventSink, readEvents, resolveEventsPath } from '@grokbot-ai-office/events';
import {
  ProvidersConfigError,
  type ProvidersFile,
  isAvailableOn,
  loadProvidersConfig,
  parseInstanceId,
  readRelayHost,
  resolveProvidersPath,
} from '@grokbot-ai-office/registry';

import type { ResolvedMcpOptions } from './options.js';

const providerArgSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:@[a-z0-9]+(?:-[a-z0-9]+)*)?$/);

const instanceSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*@[a-z0-9]+(?:-[a-z0-9]+)*$/);

const taskIdSchema = z.string().min(1).max(200);

const authSchema = z.enum(['subscription', 'api_key', 'openai_compatible']);

interface LoadedRegistry {
  config: ProvidersFile;
  host: string;
  hostName: string | undefined;
}

interface ProgressExtra {
  _meta?: { progressToken?: string | number };
  sendNotification(notification: {
    method: 'notifications/progress';
    params: {
      progressToken: string | number;
      progress: number;
      message?: string;
    };
  }): Promise<void>;
}

/**
 * 固定到单个 AI 的工具集：只给 ask（不带 provider 参数）和 office_status。
 * 用于 /mcp/<agent>，让每个 Grok Bot 只看见自己的模型。
 */
export function registerPinnedTools(
  server: McpServer,
  options: ResolvedMcpOptions,
  agent: string,
): void {
  server.registerTool(
    'ask',
    {
      title: `问 ${agent}`,
      description: `向本机的 ${agent} 提问。不会执行命令。`,
      inputSchema: {
        prompt: z.string().min(1),
        taskId: taskIdSchema.optional(),
      },
      outputSchema: {
        text: z.string(),
        instance: z.string(),
        taskId: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args, extra) =>
      ask(
        options,
        {
          provider: agent,
          prompt: args.prompt,
          ...(args.taskId === undefined ? {} : { taskId: args.taskId }),
        },
        extra,
      ),
  );
  server.registerTool(
    'office_status',
    {
      title: '办公室状态',
      description: '读取办公室快照：每个实例的状态、最近活动和待批准事项。',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => officeStatus(options),
  );
}

/** 注册表里是否有这个名字（供 /mcp/<agent> 路由校验）。 */
export function hasRegisteredAgent(options: ResolvedMcpOptions, agent: string): boolean {
  try {
    return Object.hasOwn(loadRegistry(options).config.providers, agent);
  } catch {
    return false;
  }
}

export function registerRelayTools(server: McpServer, options: ResolvedMcpOptions): void {
  server.registerTool(
    'ask',
    {
      title: '提问',
      description:
        '向注册表里的一个 AI 提问。provider 只能是 providers.yaml 中的名字，或 provider@host。不会执行命令。',
      inputSchema: {
        provider: providerArgSchema,
        prompt: z.string().min(1),
        taskId: taskIdSchema.optional(),
      },
      outputSchema: {
        text: z.string(),
        instance: z.string(),
        taskId: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args, extra) => ask(options, args, extra),
  );

  server.registerTool(
    'list_agents',
    {
      title: '列出 AI',
      description:
        '列出注册表中的 AI：接入方式、hosts、本机实例名，以及当前 RELAY_HOST 上是否可用。',
      inputSchema: {},
      outputSchema: {
        host: z.string(),
        agents: z.array(
          z.object({
            name: z.string(),
            auth: authSchema,
            hosts: z.array(z.string()).nullable(),
            instance: z.string(),
            usable: z.boolean(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => listAgents(options),
  );

  server.registerTool(
    'office_status',
    {
      title: '办公室状态',
      description:
        '读取办公室快照，与 GET /state 相同：每个实例的状态、最近活动和有长度上限的 terminalTail，并附上待批准事项。可以展示在聊天里。',
      inputSchema: {},
      outputSchema: {
        v: z.literal(1),
        generatedAt: z.string(),
        instances: z.array(instanceSnapshotSchema),
        pendingApprovals: z.array(approvalRecordSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => officeStatus(options),
  );

  server.registerTool(
    'handoff',
    {
      title: '交接文件',
      description: '把一个文件复制到工作目录的 outbox。from 和 to 都是 provider@host。不执行文件。',
      inputSchema: {
        from: instanceSchema,
        to: instanceSchema,
        filePath: z.string().min(1),
        note: z.string().min(1).max(200).optional(),
      },
      outputSchema: {
        relativePath: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const result = await handoff({
          from: args.from,
          to: args.to,
          filePath: path.resolve(options.cwd, args.filePath),
          ...(args.note === undefined ? {} : { note: args.note }),
          workspace: resolveWorkspace(options.env),
          events: createJsonlEventSink(resolveEventsPath(options.env)),
        });
        return ok({ relativePath: result.relativePath });
      }),
  );

  server.registerTool(
    'approval_request',
    {
      title: '请求批准',
      description: '记一条待批准事项，状态变为 waiting_approval。',
      inputSchema: {
        instance: instanceSchema,
        summary: z.string().min(1),
        taskId: taskIdSchema.optional(),
      },
      outputSchema: {
        approvalId: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const result = await requestApproval({
          instance: args.instance,
          summary: args.summary,
          ...(args.taskId === undefined ? {} : { taskId: args.taskId }),
          events: createJsonlEventSink(resolveEventsPath(options.env)),
        });
        return ok({ approvalId: result.approvalId });
      }),
  );

  server.registerTool(
    'approval_resolve',
    {
      title: '处理批准',
      description: '同意或拒绝一条待批准事项。approved 为 true 表示同意，false 表示拒绝。',
      inputSchema: {
        approvalId: z.string().min(1).max(200),
        approved: z.boolean(),
      },
      outputSchema: {
        approvalId: z.string(),
        approved: z.boolean(),
        instance: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const records = listApprovals(await readEvents(resolveEventsPath(options.env)));
        const found = records.find((record) => record.id === args.approvalId);
        if (!found) {
          throw new RelayError('CONFIG_INVALID', '找不到批准事项');
        }
        if (found.status !== 'pending') {
          throw new RelayError('CONFIG_INVALID', '该事项已处理');
        }
        await resolveApproval({
          approvalId: args.approvalId,
          approved: args.approved,
          instance: found.instance,
          events: createJsonlEventSink(resolveEventsPath(options.env)),
        });
        return ok({
          approvalId: args.approvalId,
          approved: args.approved,
          instance: found.instance,
        });
      }),
  );

  server.registerTool(
    'approval_list',
    {
      title: '列出批准',
      description: '列出批准事项，包含 pending、approved 和 denied。',
      inputSchema: {},
      outputSchema: {
        approvals: z.array(approvalRecordSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () =>
      runTool(async () => {
        const approvals = listApprovals(await readEvents(resolveEventsPath(options.env))).map(
          (record) => ({
            ...record,
            summary: redactSecrets(record.summary),
          }),
        );
        return ok({ approvals });
      }),
  );
}

async function ask(
  options: ResolvedMcpOptions,
  args: { provider: string; prompt: string; taskId?: string },
  extra: ProgressExtra,
): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.prompt.trim().length === 0) {
      throw new RelayError('CONFIG_INVALID', '提示不能为空');
    }
    const loaded = loadRegistry(options);
    const parsed = parseProviderArg(args.provider);
    const taskId = args.taskId ?? `r_${randomUUID()}`;
    const result = await relay(
      {
        provider: parsed.provider,
        prompt: args.prompt,
        timeoutMs: loaded.config.defaults.timeout_ms,
      },
      {
        hasProvider: (name) => Object.hasOwn(loaded.config.providers, name),
        isAvailableOnHost: (name) => {
          const provider = loaded.config.providers[name];
          return provider ? isAvailableOn(provider, loaded.hostName) : false;
        },
        ...(parsed.requestedHost === undefined ? {} : { requestedHost: parsed.requestedHost }),
        host: loaded.host,
        events: progressSink(options, extra),
        promptPreviewChars: readPromptPreviewChars(options.env),
        outputChunkChars: readOutputChunkChars(options.env),
        createRequestId: () => taskId,
        resolveAdapter: (name) => adapterFor(options, loaded, name),
      },
    );
    if (!result.ok || result.text === undefined) {
      throw result.error ?? new RelayError('EMPTY_RESPONSE', '没有返回内容');
    }
    return ok({
      text: redactSecrets(result.text),
      instance: formatInstance(parsed.provider, loaded.host),
      taskId,
    });
  });
}

async function listAgents(options: ResolvedMcpOptions): Promise<CallToolResult> {
  return runTool(async () => {
    const loaded = loadRegistry(options);
    const agents = Object.entries(loaded.config.providers)
      .map(([name, provider]) => ({
        name,
        auth: provider.auth,
        hosts: provider.hosts ?? null,
        instance: formatInstance(name, loaded.host),
        usable: isAvailableOn(provider, loaded.hostName),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return ok({ host: loaded.host, agents });
  });
}

async function officeStatus(options: ResolvedMcpOptions): Promise<CallToolResult> {
  return runTool(async () => {
    const events = await readEvents(resolveEventsPath(options.env));
    const snapshot = reduceEvents(events, { chunkLimit: readStateChunkLimit(options.env) });
    const pendingApprovals = listApprovals(events)
      .filter((record) => record.status === 'pending')
      .map((record) => ({ ...record, summary: redactSecrets(record.summary) }));
    return ok({
      v: 1,
      generatedAt: new Date().toISOString(),
      instances: presentSnapshot(snapshot).instances,
      pendingApprovals,
    });
  });
}

function progressSink(options: ResolvedMcpOptions, extra: ProgressExtra): EventSink {
  const inner = createJsonlEventSink(resolveEventsPath(options.env));
  const token = readProgressToken(extra);
  return {
    async emit(event: RelayEvent): Promise<void> {
      await inner.emit(event);
      if (token === undefined || event.type !== 'output_chunk') {
        return;
      }
      const message = redactSecrets(event.payload.text);
      try {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken: token,
            progress: event.payload.seq,
            ...(message.length > 0 ? { message } : {}),
          },
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : 'Error';
        options.log(`进度通知发送失败：${name}`);
      }
    },
  };
}

function adapterFor(
  options: ResolvedMcpOptions,
  loaded: LoadedRegistry,
  name: string,
): AdapterPort | undefined {
  const provider = loaded.config.providers[name];
  if (!provider) {
    return undefined;
  }
  if (options.resolveAdapter) {
    return options.resolveAdapter(name, provider);
  }
  return createAdapter(provider, name, { env: options.env });
}

function loadRegistry(options: ResolvedMcpOptions): LoadedRegistry {
  let hostName: string | undefined;
  try {
    hostName = readRelayHost(options.env);
  } catch (error) {
    const detail = error instanceof ProvidersConfigError ? error.message : 'RELAY_HOST 无效';
    throw new RelayError('CONFIG_INVALID', detail, { cause: error });
  }
  let config: ProvidersFile;
  try {
    config = loadProvidersConfig(resolveProvidersPath(options.cwd));
  } catch (error) {
    if (error instanceof ProvidersConfigError) {
      throw new RelayError('CONFIG_INVALID', error.message, { cause: error });
    }
    throw error;
  }
  return { config, host: hostName ?? '', hostName };
}

function parseProviderArg(value: string): { provider: string; requestedHost?: string } {
  if (!value.includes('@')) {
    return { provider: value };
  }
  try {
    const parsed = parseInstanceId(value);
    return { provider: parsed.provider, requestedHost: parsed.host };
  } catch (error) {
    const detail = error instanceof ProvidersConfigError ? error.message : '实例标识无效';
    throw new RelayError('CONFIG_INVALID', detail, { cause: error });
  }
}

function readProgressToken(extra: ProgressExtra): string | number | undefined {
  const token = extra._meta?.progressToken;
  if (typeof token === 'string' || typeof token === 'number') {
    return token;
  }
  return undefined;
}

async function runTool(action: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    const mapped = failureFrom(error);
    if (mapped) {
      return mapped;
    }
    if (error instanceof Error && redactSecrets(error.message) !== error.message) {
      throw new Error(redactSecrets(error.message), { cause: error });
    }
    throw error;
  }
}

function failureFrom(error: unknown): CallToolResult | undefined {
  if (error instanceof RelayError) {
    return failure(error);
  }
  if (error instanceof ProvidersConfigError) {
    return failure(new RelayError('CONFIG_INVALID', error.message, { cause: error }));
  }
  return undefined;
}

function failure(error: RelayError): CallToolResult {
  const message = redactSecrets(error.message);
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `${error.code} ${message.length > 0 ? message : '未知错误'}`,
      },
    ],
  };
}

function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function presentSnapshot(snapshot: OfficeSnapshot): OfficeSnapshot {
  return {
    v: 1,
    instances: snapshot.instances.map((item) => ({
      instance: item.instance,
      provider: item.provider,
      host: item.host,
      status: item.status,
      ...(item.statusSource === undefined ? {} : { statusSource: item.statusSource }),
      ...(item.taskId === undefined ? {} : { taskId: item.taskId }),
      ...(item.taskPreview === undefined ? {} : { taskPreview: redactSecrets(item.taskPreview) }),
      ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
      terminalTail: redactSecrets(item.terminalTail),
      chunks: item.chunks.map((chunk) => ({
        seq: chunk.seq,
        text: redactSecrets(chunk.text),
        ts: chunk.ts,
        ...(chunk.taskId === undefined ? {} : { taskId: chunk.taskId }),
      })),
      hookActive: item.hookActive,
      ...(item.detail === undefined ? {} : { detail: redactDetail(item.detail) }),
    })),
  };
}

function redactDetail(detail: InstanceDetail): InstanceDetail {
  return {
    ...detail,
    ...(detail.reason === undefined ? {} : { reason: redactSecrets(detail.reason) }),
    ...(detail.summary === undefined ? {} : { summary: redactSecrets(detail.summary) }),
    ...(detail.note === undefined ? {} : { note: redactSecrets(detail.note) }),
    ...(detail.filePath === undefined ? {} : { filePath: redactSecrets(detail.filePath) }),
  };
}

const approvalRecordSchema = z.object({
  id: z.string(),
  instance: z.string(),
  summary: z.string(),
  status: z.enum(['pending', 'approved', 'denied']),
  ts: z.string(),
});

const instanceSnapshotSchema = z.object({
  instance: z.string(),
  provider: z.string(),
  host: z.string(),
  status: z.string(),
  statusSource: z.string().optional(),
  taskId: z.string().optional(),
  taskPreview: z.string().optional(),
  updatedAt: z.string().optional(),
  terminalTail: z.string(),
  chunks: z.array(
    z.object({
      seq: z.number(),
      text: z.string(),
      ts: z.string(),
      taskId: z.string().optional(),
    }),
  ),
  hookActive: z.boolean(),
  detail: z
    .object({
      code: z.string().optional(),
      reason: z.string().optional(),
      approvalId: z.string().optional(),
      summary: z.string().optional(),
      approved: z.boolean().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      filePath: z.string().optional(),
      note: z.string().optional(),
    })
    .optional(),
});
