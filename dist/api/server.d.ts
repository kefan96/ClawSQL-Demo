/**
 * REST API Server
 *
 * Fastify-based REST API for ClawSQL.
 */
import type { FastifyInstance } from 'fastify';
import type { Config } from '../types/config.js';
export declare function createServer(config: Config): Promise<FastifyInstance>;
export declare function startServer(config: Config): Promise<FastifyInstance>;
//# sourceMappingURL=server.d.ts.map