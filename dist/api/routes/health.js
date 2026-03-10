/**
 * Health API Routes
 */
import { getHealthService } from '../../services/health.js';
export async function healthRoutes(fastify) {
    const healthService = getHealthService();
    // GET /api/health - Overall health
    fastify.get('/', async (request, reply) => {
        const health = await healthService.getHealth();
        return reply.code(health.healthy ? 200 : 503).send(health);
    });
    // GET /api/health/mysql - MySQL health
    fastify.get('/mysql', async (request, reply) => {
        const health = await healthService.getMySQLHealth();
        return reply.code(health.healthy ? 200 : 503).send(health);
    });
    // GET /api/health/replication - Replication status
    fastify.get('/replication', async (request, reply) => {
        const status = await healthService.getReplicationStatus();
        return status;
    });
    // GET /api/health/proxysql - ProxySQL health
    fastify.get('/proxysql', async (request, reply) => {
        const health = await healthService.getProxySQLHealth();
        return reply.code(health.healthy ? 200 : 503).send(health);
    });
    // GET /api/health/instance/:host/:port - Specific instance health
    fastify.get('/instance/:host/:port', async (request, reply) => {
        const { host, port } = request.params;
        const portNum = parseInt(port, 10);
        if (isNaN(portNum)) {
            return reply.code(400).send({ error: 'Invalid port number' });
        }
        const health = await healthService.checkInstanceHealth(host, portNum, true);
        return reply.code(health.healthy ? 200 : 503).send(health);
    });
}
//# sourceMappingURL=health.js.map