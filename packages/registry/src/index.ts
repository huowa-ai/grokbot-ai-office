export {
  formatInstanceId,
  isAvailableOn,
  parseInstanceId,
  readRelayHost,
} from './host.js';
export type { InstanceId } from './host.js';
export {
  loadProvidersConfig,
  parseProvidersConfig,
  ProvidersConfigError,
  resolveProvidersPath,
} from './load.js';
export type { ConfigIssue } from './load.js';
export {
  AUTH_METHODS,
  OFFICE_ACCESSORIES,
  OFFICE_BODIES,
  OFFICE_DESK_PROPS,
  OFFICE_IDLE_POSES,
  OFFICE_TYPING,
  extractOfficeAppearances,
  hostNameSchema,
  officeAppearanceSchema,
  providersFileSchema,
} from './schema.js';
export type { AuthMethod, OfficeAppearance, ProviderConfig, ProvidersFile } from './schema.js';
