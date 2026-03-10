/**
 * Configuration Loader
 *
 * Loads configuration from:
 * 1. Default config file (config/default.yaml)
 * 2. Custom config file (via --config or CLAWSQL_CONFIG)
 * 3. Environment variables (CLAWSQL_*)
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ConfigSchema } from '../types/config.js';
const DEFAULT_CONFIG_PATH = 'config/default.yaml';
const LOCAL_CONFIG_PATH = 'config/local.yaml';
/**
 * Expand environment variables in a string
 * Supports ${VAR} and ${VAR:-default} syntax
 */
function expandEnvVars(value) {
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
function expandEnvVarsDeep(obj) {
    if (typeof obj === 'string') {
        return expandEnvVars(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(item => expandEnvVarsDeep(item));
    }
    if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = expandEnvVarsDeep(value);
        }
        return result;
    }
    return obj;
}
/**
 * Load configuration from a YAML file
 */
function loadYamlFile(path) {
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
function envToPath(envName) {
    const prefix = 'CLAWSQL_';
    if (!envName.startsWith(prefix))
        return null;
    const rest = envName.slice(prefix.length);
    return rest.toLowerCase().split('_');
}
/**
 * Set a value in a nested object using a path
 */
function setNestedValue(obj, path, value) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (key === undefined)
            continue;
        if (!(key in current) || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    const lastKey = path[path.length - 1];
    if (lastKey !== undefined) {
        current[lastKey] = value;
    }
}
/**
 * Load configuration from environment variables
 */
function loadFromEnv() {
    const config = {};
    for (const [name, value] of Object.entries(process.env)) {
        const path = envToPath(name);
        if (path && value !== undefined) {
            // Try to parse as JSON for complex values
            let parsed;
            try {
                parsed = JSON.parse(value);
            }
            catch {
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
function deepMerge(target, source) {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (key in result &&
            typeof result[key] === 'object' &&
            result[key] !== null &&
            !Array.isArray(result[key]) &&
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)) {
            result[key] = deepMerge(result[key], value);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
let _config = null;
/**
 * Load and validate configuration
 */
export function loadConfig(configPath) {
    // Start with defaults
    let config = {};
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
export function getConfig() {
    if (!_config) {
        return loadConfig();
    }
    return _config;
}
/**
 * Reset configuration (for testing)
 */
export function resetConfig() {
    _config = null;
}
/**
 * Save configuration to a local config file
 * Only saves non-default values to config/local.yaml
 */
export function saveConfig(config, configPath) {
    const targetPath = configPath || resolve(LOCAL_CONFIG_PATH);
    // Ensure directory exists
    const dir = dirname(targetPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    // Convert to YAML and save
    const yamlContent = stringifyYaml(config, {
        defaultStringType: 'QUOTE_DOUBLE',
        defaultKeyType: 'PLAIN',
    });
    writeFileSync(targetPath, yamlContent, 'utf-8');
    // Reset cached config so it will reload on next access
    _config = null;
}
/**
 * Update a specific configuration value
 */
export function updateConfig(path, value) {
    const config = getConfig();
    const pathParts = path.split('.');
    // Create a deep copy and update the value
    const updated = JSON.parse(JSON.stringify(config));
    let current = updated;
    for (let i = 0; i < pathParts.length - 1; i++) {
        const key = pathParts[i];
        if (key === undefined)
            continue;
        if (!(key in current) || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    const lastKey = pathParts[pathParts.length - 1];
    if (lastKey !== undefined) {
        current[lastKey] = value;
    }
    // Validate the updated config
    const result = ConfigSchema.safeParse(updated);
    if (!result.success) {
        const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
    _config = result.data;
}
/**
 * Get configuration file path
 */
export function getConfigPath() {
    return process.env.CLAWSQL_CONFIG || LOCAL_CONFIG_PATH;
}
//# sourceMappingURL=loader.js.map