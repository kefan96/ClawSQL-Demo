/**
 * Configuration Types
 */
import { z } from 'zod';
import { SQLConfigSchema } from './sql.js';
import { MemoryConfigSchema } from './memory.js';
export declare const MySQLConfigSchema: z.ZodObject<{
    user: z.ZodDefault<z.ZodString>;
    password: z.ZodDefault<z.ZodString>;
    connectionPool: z.ZodDefault<z.ZodNumber>;
    connectTimeout: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    user: string;
    password: string;
    connectionPool: number;
    connectTimeout: number;
}, {
    user?: string | undefined;
    password?: string | undefined;
    connectionPool?: number | undefined;
    connectTimeout?: number | undefined;
}>;
export declare const ProxySQLHostgroupsSchema: z.ZodObject<{
    writer: z.ZodDefault<z.ZodNumber>;
    reader: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    writer: number;
    reader: number;
}, {
    writer?: number | undefined;
    reader?: number | undefined;
}>;
export declare const ProxySQLConfigSchema: z.ZodObject<{
    host: z.ZodDefault<z.ZodString>;
    adminPort: z.ZodDefault<z.ZodNumber>;
    dataPort: z.ZodDefault<z.ZodNumber>;
    user: z.ZodDefault<z.ZodString>;
    password: z.ZodDefault<z.ZodString>;
    hostgroups: z.ZodDefault<z.ZodObject<{
        writer: z.ZodDefault<z.ZodNumber>;
        reader: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        writer: number;
        reader: number;
    }, {
        writer?: number | undefined;
        reader?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    user: string;
    password: string;
    host: string;
    adminPort: number;
    dataPort: number;
    hostgroups: {
        writer: number;
        reader: number;
    };
}, {
    user?: string | undefined;
    password?: string | undefined;
    host?: string | undefined;
    adminPort?: number | undefined;
    dataPort?: number | undefined;
    hostgroups?: {
        writer?: number | undefined;
        reader?: number | undefined;
    } | undefined;
}>;
export declare const FailoverConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    autoFailover: z.ZodDefault<z.ZodBoolean>;
    failoverTimeout: z.ZodDefault<z.ZodNumber>;
    recoveryTimeout: z.ZodDefault<z.ZodNumber>;
    minReplicas: z.ZodDefault<z.ZodNumber>;
    maxLagSeconds: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    autoFailover: boolean;
    failoverTimeout: number;
    recoveryTimeout: number;
    minReplicas: number;
    maxLagSeconds: number;
}, {
    enabled?: boolean | undefined;
    autoFailover?: boolean | undefined;
    failoverTimeout?: number | undefined;
    recoveryTimeout?: number | undefined;
    minReplicas?: number | undefined;
    maxLagSeconds?: number | undefined;
}>;
export declare const AIFeaturesSchema: z.ZodObject<{
    analysis: z.ZodDefault<z.ZodBoolean>;
    recommendations: z.ZodDefault<z.ZodBoolean>;
    naturalLanguage: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    analysis: boolean;
    recommendations: boolean;
    naturalLanguage: boolean;
}, {
    analysis?: boolean | undefined;
    recommendations?: boolean | undefined;
    naturalLanguage?: boolean | undefined;
}>;
export declare const AIConfigSchema: z.ZodObject<{
    provider: z.ZodDefault<z.ZodEnum<["anthropic", "openai"]>>;
    apiKey: z.ZodOptional<z.ZodString>;
    baseURL: z.ZodOptional<z.ZodString>;
    model: z.ZodDefault<z.ZodString>;
    features: z.ZodDefault<z.ZodObject<{
        analysis: z.ZodDefault<z.ZodBoolean>;
        recommendations: z.ZodDefault<z.ZodBoolean>;
        naturalLanguage: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        analysis: boolean;
        recommendations: boolean;
        naturalLanguage: boolean;
    }, {
        analysis?: boolean | undefined;
        recommendations?: boolean | undefined;
        naturalLanguage?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    provider: "anthropic" | "openai";
    model: string;
    features: {
        analysis: boolean;
        recommendations: boolean;
        naturalLanguage: boolean;
    };
    apiKey?: string | undefined;
    baseURL?: string | undefined;
}, {
    provider?: "anthropic" | "openai" | undefined;
    apiKey?: string | undefined;
    baseURL?: string | undefined;
    model?: string | undefined;
    features?: {
        analysis?: boolean | undefined;
        recommendations?: boolean | undefined;
        naturalLanguage?: boolean | undefined;
    } | undefined;
}>;
export declare const SchedulerConfigSchema: z.ZodObject<{
    topologyPollInterval: z.ZodDefault<z.ZodNumber>;
    healthCheckInterval: z.ZodDefault<z.ZodNumber>;
    replicationMonitorInterval: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    topologyPollInterval: number;
    healthCheckInterval: number;
    replicationMonitorInterval: number;
}, {
    topologyPollInterval?: number | undefined;
    healthCheckInterval?: number | undefined;
    replicationMonitorInterval?: number | undefined;
}>;
export declare const WebhookEndpointSchema: z.ZodObject<{
    url: z.ZodString;
    events: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    url: string;
    events: string[];
}, {
    url: string;
    events?: string[] | undefined;
}>;
export declare const WebhooksConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    secret: z.ZodOptional<z.ZodString>;
    endpoints: z.ZodDefault<z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        events: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        events: string[];
    }, {
        url: string;
        events?: string[] | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    endpoints: {
        url: string;
        events: string[];
    }[];
    secret?: string | undefined;
}, {
    enabled?: boolean | undefined;
    secret?: string | undefined;
    endpoints?: {
        url: string;
        events?: string[] | undefined;
    }[] | undefined;
}>;
export declare const APIConfigSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    host: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    host: string;
    port: number;
}, {
    host?: string | undefined;
    port?: number | undefined;
}>;
export declare const LoggingConfigSchema: z.ZodObject<{
    level: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error", "fatal"]>>;
    format: z.ZodDefault<z.ZodEnum<["json", "pretty"]>>;
}, "strip", z.ZodTypeAny, {
    level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
    format: "json" | "pretty";
}, {
    level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | undefined;
    format?: "json" | "pretty" | undefined;
}>;
export declare const ClusterConfigSchema: z.ZodObject<{
    name: z.ZodDefault<z.ZodString>;
    seeds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    name: string;
    seeds: string[];
}, {
    seeds: string[];
    name?: string | undefined;
}>;
export declare const ConfigSchema: z.ZodObject<{
    cluster: z.ZodObject<{
        name: z.ZodDefault<z.ZodString>;
        seeds: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        name: string;
        seeds: string[];
    }, {
        seeds: string[];
        name?: string | undefined;
    }>;
    mysql: z.ZodDefault<z.ZodObject<{
        user: z.ZodDefault<z.ZodString>;
        password: z.ZodDefault<z.ZodString>;
        connectionPool: z.ZodDefault<z.ZodNumber>;
        connectTimeout: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        user: string;
        password: string;
        connectionPool: number;
        connectTimeout: number;
    }, {
        user?: string | undefined;
        password?: string | undefined;
        connectionPool?: number | undefined;
        connectTimeout?: number | undefined;
    }>>;
    proxysql: z.ZodDefault<z.ZodObject<{
        host: z.ZodDefault<z.ZodString>;
        adminPort: z.ZodDefault<z.ZodNumber>;
        dataPort: z.ZodDefault<z.ZodNumber>;
        user: z.ZodDefault<z.ZodString>;
        password: z.ZodDefault<z.ZodString>;
        hostgroups: z.ZodDefault<z.ZodObject<{
            writer: z.ZodDefault<z.ZodNumber>;
            reader: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            writer: number;
            reader: number;
        }, {
            writer?: number | undefined;
            reader?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        user: string;
        password: string;
        host: string;
        adminPort: number;
        dataPort: number;
        hostgroups: {
            writer: number;
            reader: number;
        };
    }, {
        user?: string | undefined;
        password?: string | undefined;
        host?: string | undefined;
        adminPort?: number | undefined;
        dataPort?: number | undefined;
        hostgroups?: {
            writer?: number | undefined;
            reader?: number | undefined;
        } | undefined;
    }>>;
    failover: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        autoFailover: z.ZodDefault<z.ZodBoolean>;
        failoverTimeout: z.ZodDefault<z.ZodNumber>;
        recoveryTimeout: z.ZodDefault<z.ZodNumber>;
        minReplicas: z.ZodDefault<z.ZodNumber>;
        maxLagSeconds: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        autoFailover: boolean;
        failoverTimeout: number;
        recoveryTimeout: number;
        minReplicas: number;
        maxLagSeconds: number;
    }, {
        enabled?: boolean | undefined;
        autoFailover?: boolean | undefined;
        failoverTimeout?: number | undefined;
        recoveryTimeout?: number | undefined;
        minReplicas?: number | undefined;
        maxLagSeconds?: number | undefined;
    }>>;
    ai: z.ZodDefault<z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<["anthropic", "openai"]>>;
        apiKey: z.ZodOptional<z.ZodString>;
        baseURL: z.ZodOptional<z.ZodString>;
        model: z.ZodDefault<z.ZodString>;
        features: z.ZodDefault<z.ZodObject<{
            analysis: z.ZodDefault<z.ZodBoolean>;
            recommendations: z.ZodDefault<z.ZodBoolean>;
            naturalLanguage: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            analysis: boolean;
            recommendations: boolean;
            naturalLanguage: boolean;
        }, {
            analysis?: boolean | undefined;
            recommendations?: boolean | undefined;
            naturalLanguage?: boolean | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        provider: "anthropic" | "openai";
        model: string;
        features: {
            analysis: boolean;
            recommendations: boolean;
            naturalLanguage: boolean;
        };
        apiKey?: string | undefined;
        baseURL?: string | undefined;
    }, {
        provider?: "anthropic" | "openai" | undefined;
        apiKey?: string | undefined;
        baseURL?: string | undefined;
        model?: string | undefined;
        features?: {
            analysis?: boolean | undefined;
            recommendations?: boolean | undefined;
            naturalLanguage?: boolean | undefined;
        } | undefined;
    }>>;
    sql: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        readOnlyByDefault: z.ZodDefault<z.ZodBoolean>;
        maxRows: z.ZodDefault<z.ZodNumber>;
        timeout: z.ZodDefault<z.ZodNumber>;
        allowDDL: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        readOnlyByDefault: boolean;
        maxRows: number;
        timeout: number;
        allowDDL: boolean;
    }, {
        enabled?: boolean | undefined;
        readOnlyByDefault?: boolean | undefined;
        maxRows?: number | undefined;
        timeout?: number | undefined;
        allowDDL?: boolean | undefined;
    }>>;
    memory: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        storagePath: z.ZodDefault<z.ZodString>;
        schemaSyncInterval: z.ZodDefault<z.ZodNumber>;
        maxQueryHistory: z.ZodDefault<z.ZodNumber>;
        feedbackLearning: z.ZodDefault<z.ZodBoolean>;
        confirmationThreshold: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        storagePath: string;
        schemaSyncInterval: number;
        maxQueryHistory: number;
        feedbackLearning: boolean;
        confirmationThreshold: number;
    }, {
        enabled?: boolean | undefined;
        storagePath?: string | undefined;
        schemaSyncInterval?: number | undefined;
        maxQueryHistory?: number | undefined;
        feedbackLearning?: boolean | undefined;
        confirmationThreshold?: number | undefined;
    }>>;
    scheduler: z.ZodDefault<z.ZodObject<{
        topologyPollInterval: z.ZodDefault<z.ZodNumber>;
        healthCheckInterval: z.ZodDefault<z.ZodNumber>;
        replicationMonitorInterval: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        topologyPollInterval: number;
        healthCheckInterval: number;
        replicationMonitorInterval: number;
    }, {
        topologyPollInterval?: number | undefined;
        healthCheckInterval?: number | undefined;
        replicationMonitorInterval?: number | undefined;
    }>>;
    webhooks: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        secret: z.ZodOptional<z.ZodString>;
        endpoints: z.ZodDefault<z.ZodArray<z.ZodObject<{
            url: z.ZodString;
            events: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            events: string[];
        }, {
            url: string;
            events?: string[] | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        endpoints: {
            url: string;
            events: string[];
        }[];
        secret?: string | undefined;
    }, {
        enabled?: boolean | undefined;
        secret?: string | undefined;
        endpoints?: {
            url: string;
            events?: string[] | undefined;
        }[] | undefined;
    }>>;
    api: z.ZodDefault<z.ZodObject<{
        port: z.ZodDefault<z.ZodNumber>;
        host: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        host: string;
        port: number;
    }, {
        host?: string | undefined;
        port?: number | undefined;
    }>>;
    logging: z.ZodDefault<z.ZodObject<{
        level: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error", "fatal"]>>;
        format: z.ZodDefault<z.ZodEnum<["json", "pretty"]>>;
    }, "strip", z.ZodTypeAny, {
        level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
        format: "json" | "pretty";
    }, {
        level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | undefined;
        format?: "json" | "pretty" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    sql: {
        enabled: boolean;
        readOnlyByDefault: boolean;
        maxRows: number;
        timeout: number;
        allowDDL: boolean;
    };
    proxysql: {
        user: string;
        password: string;
        host: string;
        adminPort: number;
        dataPort: number;
        hostgroups: {
            writer: number;
            reader: number;
        };
    };
    cluster: {
        name: string;
        seeds: string[];
    };
    mysql: {
        user: string;
        password: string;
        connectionPool: number;
        connectTimeout: number;
    };
    failover: {
        enabled: boolean;
        autoFailover: boolean;
        failoverTimeout: number;
        recoveryTimeout: number;
        minReplicas: number;
        maxLagSeconds: number;
    };
    ai: {
        provider: "anthropic" | "openai";
        model: string;
        features: {
            analysis: boolean;
            recommendations: boolean;
            naturalLanguage: boolean;
        };
        apiKey?: string | undefined;
        baseURL?: string | undefined;
    };
    memory: {
        enabled: boolean;
        storagePath: string;
        schemaSyncInterval: number;
        maxQueryHistory: number;
        feedbackLearning: boolean;
        confirmationThreshold: number;
    };
    scheduler: {
        topologyPollInterval: number;
        healthCheckInterval: number;
        replicationMonitorInterval: number;
    };
    webhooks: {
        enabled: boolean;
        endpoints: {
            url: string;
            events: string[];
        }[];
        secret?: string | undefined;
    };
    api: {
        host: string;
        port: number;
    };
    logging: {
        level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
        format: "json" | "pretty";
    };
}, {
    cluster: {
        seeds: string[];
        name?: string | undefined;
    };
    sql?: {
        enabled?: boolean | undefined;
        readOnlyByDefault?: boolean | undefined;
        maxRows?: number | undefined;
        timeout?: number | undefined;
        allowDDL?: boolean | undefined;
    } | undefined;
    proxysql?: {
        user?: string | undefined;
        password?: string | undefined;
        host?: string | undefined;
        adminPort?: number | undefined;
        dataPort?: number | undefined;
        hostgroups?: {
            writer?: number | undefined;
            reader?: number | undefined;
        } | undefined;
    } | undefined;
    mysql?: {
        user?: string | undefined;
        password?: string | undefined;
        connectionPool?: number | undefined;
        connectTimeout?: number | undefined;
    } | undefined;
    failover?: {
        enabled?: boolean | undefined;
        autoFailover?: boolean | undefined;
        failoverTimeout?: number | undefined;
        recoveryTimeout?: number | undefined;
        minReplicas?: number | undefined;
        maxLagSeconds?: number | undefined;
    } | undefined;
    ai?: {
        provider?: "anthropic" | "openai" | undefined;
        apiKey?: string | undefined;
        baseURL?: string | undefined;
        model?: string | undefined;
        features?: {
            analysis?: boolean | undefined;
            recommendations?: boolean | undefined;
            naturalLanguage?: boolean | undefined;
        } | undefined;
    } | undefined;
    memory?: {
        enabled?: boolean | undefined;
        storagePath?: string | undefined;
        schemaSyncInterval?: number | undefined;
        maxQueryHistory?: number | undefined;
        feedbackLearning?: boolean | undefined;
        confirmationThreshold?: number | undefined;
    } | undefined;
    scheduler?: {
        topologyPollInterval?: number | undefined;
        healthCheckInterval?: number | undefined;
        replicationMonitorInterval?: number | undefined;
    } | undefined;
    webhooks?: {
        enabled?: boolean | undefined;
        secret?: string | undefined;
        endpoints?: {
            url: string;
            events?: string[] | undefined;
        }[] | undefined;
    } | undefined;
    api?: {
        host?: string | undefined;
        port?: number | undefined;
    } | undefined;
    logging?: {
        level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | undefined;
        format?: "json" | "pretty" | undefined;
    } | undefined;
}>;
export type MySQLConfig = z.infer<typeof MySQLConfigSchema>;
export type ProxySQLConfig = z.infer<typeof ProxySQLConfigSchema>;
export type FailoverConfig = z.infer<typeof FailoverConfigSchema>;
export type AIConfig = z.infer<typeof AIConfigSchema>;
export type SQLConfig = z.infer<typeof SQLConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;
export type WebhooksConfig = z.infer<typeof WebhooksConfigSchema>;
export type APIConfig = z.infer<typeof APIConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
//# sourceMappingURL=config.d.ts.map