import { z } from 'zod';

export const AUTH_METHODS = ['subscription', 'api_key', 'openai_compatible'] as const;

export type AuthMethod = (typeof AUTH_METHODS)[number];

const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const providerNameSchema = z.string().regex(namePattern, '提供者名字必须是小写字母、数字和连字符');

export const hostNameSchema = z.string().regex(namePattern, '主机名必须是小写字母、数字和连字符');

const hostsSchema = z.array(hostNameSchema).optional();

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #RRGGBB');

export const OFFICE_BODIES = [
  'robot',
  'round',
  'twin',
  'headset',
  'messenger',
  'lobster',
  'whale',
  'blob',
] as const;

export const OFFICE_ACCESSORIES = [
  'antenna',
  'scarf',
  'sparkles',
  'headset',
  'wings',
  'claws',
  'spout',
  'none',
] as const;

export const OFFICE_DESK_PROPS = [
  'keyboard',
  'books',
  'stars',
  'plant',
  'satchel',
  'shell',
  'wave',
  'mug',
] as const;

export const OFFICE_IDLE_POSES = ['sleep', 'sway', 'hover', 'perch', 'bob'] as const;

export const OFFICE_TYPING = ['keys', 'nod', 'flip', 'clack', 'wings', 'claws', 'tail'] as const;

export const officeAppearanceSchema = z
  .object({
    body: z.enum(OFFICE_BODIES).optional(),
    palette: z
      .object({
        primary: hexColor.optional(),
        secondary: hexColor.optional(),
        accent: hexColor.optional(),
      })
      .strict()
      .optional(),
    accessory: z.enum(OFFICE_ACCESSORIES).optional(),
    desk_prop: z.enum(OFFICE_DESK_PROPS).optional(),
    bezel: hexColor.optional(),
    name_tag: hexColor.optional(),
    idle_pose: z.enum(OFFICE_IDLE_POSES).optional(),
    typing: z.enum(OFFICE_TYPING).optional(),
  })
  .strict();

export type OfficeAppearance = z.infer<typeof officeAppearanceSchema>;

const officeField = { office: officeAppearanceSchema.optional() };

const keyEnvSchema = z.string().superRefine((value, ctx) => {
  if (/sk-/i.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'key_env 疑似密钥，只能填写环境变量名',
    });
    return;
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'key_env 必须是全大写加下划线的变量名',
    });
  }
});

const subscriptionProviderSchema = z
  .object({
    auth: z.literal('subscription'),
    command: z.array(z.string().min(1)).min(1),
    input: z.enum(['stdin', 'arg', 'file']).optional(),
    safe_mode: z.string().refine((value) => value.trim().length > 0, 'safe_mode 不能为空'),
    output_filter: z.string().optional(),
    pty: z.boolean().optional(),
    hosts: hostsSchema,
    ...officeField,
  })
  .strict();

const apiKeyProviderSchema = z
  .object({
    auth: z.literal('api_key'),
    vendor: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    key_env: keyEnvSchema,
    hosts: hostsSchema,
    ...officeField,
  })
  .strict();

const openaiCompatibleProviderSchema = z
  .object({
    auth: z.literal('openai_compatible'),
    base_url: z.string().url(),
    model: z.string().min(1),
    key_env: keyEnvSchema.nullable().optional(),
    hosts: hostsSchema,
    ...officeField,
  })
  .strict();

const providerSchema = z.discriminatedUnion('auth', [
  subscriptionProviderSchema,
  apiKeyProviderSchema,
  openaiCompatibleProviderSchema,
]);

export const providersFileSchema = z
  .object({
    version: z.literal(1),
    defaults: z
      .object({
        timeout_ms: z.number().int().positive(),
      })
      .strict(),
    providers: z.record(providerNameSchema, providerSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    rejectSecretStrings(value, ctx);
  });

export type ProvidersFile = z.infer<typeof providersFileSchema>;
export type ProviderConfig = ProvidersFile['providers'][string];

export function extractOfficeAppearances(file: ProvidersFile): Record<string, OfficeAppearance> {
  const styles: Record<string, OfficeAppearance> = {};
  for (const [name, provider] of Object.entries(file.providers)) {
    if (provider.office) {
      styles[name] = provider.office;
    }
  }
  return styles;
}

function rejectSecretStrings(
  value: unknown,
  ctx: z.RefinementCtx,
  path: Array<string | number> = [],
): void {
  if (typeof value === 'string') {
    if (/sk-/i.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '疑似密钥，禁止写入配置',
        path,
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      rejectSecretStrings(item, ctx, [...path, index]);
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (/sk-/i.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '疑似密钥，禁止写入配置',
          path: [...path, key],
        });
      }
      rejectSecretStrings(nested, ctx, [...path, key]);
    }
  }
}
