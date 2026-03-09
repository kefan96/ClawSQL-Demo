/**
 * Configuration Loader
 *
 * Loads configuration from:
 * 1. Default config file (config/default.yaml)
 * 2. Custom config file (via --config or CLAWSQL_CONFIG)
 * 3. Environment variables (CLAWSQL_*)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema, type Config } from '../types/config.js';

const DEFAULT_CONFIG_PATH = 'config/default.yaml';

/**
 * Expand environment variables in a string
 * Supports ${VAR} and ${VAR:-default} syntax
 */
function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const hasDefault = expr.includes(':-');
    if (hasDefault) {
      const [name, defaultValue] = expr.split(':-');
      return process.env[name] ?? defaultValue;
    }
    return process.env[expr] ?? '';
  });
}

/**
 * Recursively expand environment variables in an object
 */
function expandEnvVarsDeep<T>(obj: T): T {
  if (typeof obj === 'string') {
    return expandEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => expandEnvVarsDeep(item)) as T;
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsDeep(value);
    }
    return result as T;
  }
  return obj;
}

/**
 * Load configuration from a YAML file
 */
function loadYamlFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new Error(`Configuration file not found: ${path}`);
  }

  const content = readFileSync(path, 'utf-8');
  const parsed = parseYaml(content);
  return expandEnvVarsDeep(parsed);
}

/**
 * Convert environment variable name to config path
 * CLAWSQL_MYSQL_HOST -> mysql.host
 */
function envToPath(envName: string): string[] | null {
  const prefix = 'CLAWSQL_';
  if (!envName.startsWith(prefix)) return null;

  const rest = envName.slice(prefix.length);
  return rest.toLowerCase().split('_');
}

/**
 * Set a value in a nested object using a path
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (key === undefined) continue;
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = path[path.length - 1];
  if (lastKey !== undefined) {
    current[lastKey] = value;
  }
}

/**
 * Load configuration from environment variables
 */
function loadFromEnv(): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(process.env)) {
    const path = envToPath(name);
    if (path && value !== undefined) {
      // Try to parse as JSON for complex values
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }
      setNestedValue(config, path, parsed);
    }
  }

  return config;
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>
): T {
  const result = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (
      key in result &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key]) &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

let _config: Config | null = null;

/**
 * Load and validate configuration
 */
export function loadConfig(configPath?: string): Config {
  // Start with defaults
  let config: Record<string, unknown> = {};

  // Load default config
  const defaultPath = resolve(DEFAULT_CONFIG_PATH);
  if (existsSync(defaultPath)) {
    config = loadYamlFile(defaultPath);
  }

  // Load custom config file
  const customPath = configPath ?? process.env.CLAWSQL_CONFIG;
  if (customPath) {
    const resolvedPath = resolve(customPath);
    const customConfig = loadYamlFile(resolvedPath);
    config = deepMerge(config, customConfig);
  }

  // Load from environment variables (highest priority)
  const envConfig = loadFromEnv();
  if (Object.keys(envConfig).length > 0) {
    config = deepMerge(config, envConfig);
  }

  // Validate and parse
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  _config = result.data;
  return result.data;
}

/**
 * Get the current configuration
 */
export function getConfig(): Config {
  if (!_config) {
    return loadConfig();
  }
  return _config;
}

/**
 * Reset configuration (for testing)
 */
export function resetConfig(): void {
  _config = null;
}