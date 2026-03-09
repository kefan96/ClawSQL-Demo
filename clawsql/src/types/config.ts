/**
 * Configuration Types
 */

import { z } from 'zod';

export const MySQLConfigSchema = z.object({
  user: z.string().default('root'),
  password: z.string().default(''),
  connectionPool: z.number().int().positive().default(10),
  connectTimeout: z.number().int().positive().default(5000),
});

export const ProxySQLHostgroupsSchema = z.object({
  writer: z.number().int().positive().default(10),
  reader: z.number().int().positive().default(20),
});

export const ProxySQLConfigSchema = z.object({
  host: z.string().default('proxysql'),
  adminPort: z.number().int().positive().default(6032),
  dataPort: z.number().int().positive().default(6033),
  user: z.string().default('admin'),
  password: z.string().default('admin'),
  hostgroups: ProxySQLHostgroupsSchema.default({ writer: 10, reader: 20 }),
});

export const FailoverConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoFailover: z.boolean().default(false),
  failoverTimeout: z.number().int().positive().default(30),
  recoveryTimeout: z.number().int().positive().default(60),
  minReplicas: z.number().int().min(0).default(1),
  maxLagSeconds: z.number().int().positive().default(5),
});

export const AIFeaturesSchema = z.object({
  analysis: z.boolean().default(true),
  recommendations: z.boolean().default(true),
  naturalLanguage: z.boolean().default(true),
});

export const AIConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),
  apiKey: z.string().optional(),
  model: z.string().default('claude-sonnet-4-6'),
  features: AIFeaturesSchema.default({
    analysis: true,
    recommendations: true,
    naturalLanguage: true,
  }),
});

export const SchedulerConfigSchema = z.object({
  topologyPollInterval: z.number().int().positive().default(5000),
  healthCheckInterval: z.number().int().positive().default(3000),
  replicationMonitorInterval: z.number().int().positive().default(2000),
});

export const WebhookEndpointSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).default([]),
});

export const WebhooksConfigSchema = z.object({
  enabled: z.boolean().default(true),
  secret: z.string().optional(),
  endpoints: z.array(WebhookEndpointSchema).default([]),
});

export const APIConfigSchema = z.object({
  port: z.number().int().positive().default(8080),
  host: z.string().default('0.0.0.0'),
});

export const LoggingConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  format: z.enum(['json', 'pretty']).default('json'),
});

export const ClusterConfigSchema = z.object({
  name: z.string().default('clawsql-cluster'),
  seeds: z.array(z.string()).min(1),
});

export const ConfigSchema = z.object({
  cluster: ClusterConfigSchema,
  mysql: MySQLConfigSchema.default({}),
  proxysql: ProxySQLConfigSchema.default({}),
  failover: FailoverConfigSchema.default({}),
  ai: AIConfigSchema.default({}),
  scheduler: SchedulerConfigSchema.default({}),
  webhooks: WebhooksConfigSchema.default({}),
  api: APIConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
});

export type MySQLConfig = z.infer<typeof MySQLConfigSchema>;
export type ProxySQLConfig = z.infer<typeof ProxySQLConfigSchema>;
export type FailoverConfig = z.infer<typeof FailoverConfigSchema>;
export type AIConfig = z.infer<typeof AIConfigSchema>;
export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;
export type WebhooksConfig = z.infer<typeof WebhooksConfigSchema>;
export type APIConfig = z.infer<typeof APIConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;