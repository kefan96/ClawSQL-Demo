/**
 * Configuration Loader
 *
 * Loads configuration from:
 * 1. Default config file (config/default.yaml)
 * 2. Custom config file (via --config or CLAWSQL_CONFIG)
 * 3. Environment variables (CLAWSQL_*)
 */
import { type Config } from '../types/config.js';
/**
 * Load and validate configuration
 */
export declare function loadConfig(configPath?: string): Config;
/**
 * Get the current configuration
 */
export declare function getConfig(): Config;
/**
 * Reset configuration (for testing)
 */
export declare function resetConfig(): void;
/**
 * Save configuration to a local config file
 * Only saves non-default values to config/local.yaml
 */
export declare function saveConfig(config: Partial<Config>, configPath?: string): void;
/**
 * Update a specific configuration value
 */
export declare function updateConfig(path: string, value: unknown): void;
/**
 * Get configuration file path
 */
export declare function getConfigPath(): string;
//# sourceMappingURL=loader.d.ts.map