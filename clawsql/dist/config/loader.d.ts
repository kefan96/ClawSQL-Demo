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
//# sourceMappingURL=loader.d.ts.map