/**
 * Failover API Routes
 */
import { getFailoverService } from '../../services/failover.js';
export async function failoverRoutes(fastify) {
    const failoverService = getFailoverService();
    // POST /api/failover/switchover - Graceful switchover
    fastify.post('/switchover', async (request, reply) => {
        try {
            const { target } = request.body || {};
            const result = await failoverService.switchover(target);
            return reply.code(result.success ? 200 : 500).send(result);
        }
        catch (error) {
            return reply.code(500).send({
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    // POST /api/failover/failover - Emergency failover
    fastify.post('/failover', async (request, reply) => {
        try {
            const result = await failoverService.failover();
            return reply.code(result.success ? 200 : 500).send(result);
        }
        catch (error) {
            return reply.code(500).send({
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    // POST /api/failover/rollback - Rollback to previous
    fastify.post('/rollback', async (request, reply) => {
        try {
            const result = await failoverService.rollback();
            return reply.code(result.success ? 200 : 500).send(result);
        }
        catch (error) {
            return reply.code(500).send({
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    // GET /api/failover/status - Current failover state
    fastify.get('/status', async (request, reply) => {
        const state = failoverService.getState();
        return {
            inProgress: state.inProgress,
            type: state.type,
            startedAt: state.startedAt,
            oldPrimary: state.oldPrimary,
            targetPrimary: state.targetPrimary,
            step: state.step,
            error: state.error,
        };
    });
    // GET /api/failover/check - Pre-switchover check
    fastify.get('/check', async (request, reply) => {
        try {
            const check = await failoverService.canSwitchover();
            return check;
        }
        catch (error) {
            return reply.code(500).send({
                canSwitchover: false,
                reasons: [error instanceof Error ? error.message : 'Unknown error'],
                warnings: [],
                suggestedTarget: null,
            });
        }
    });
    // GET /api/failover/validate - Validate topology
    fastify.get('/validate', async (request, reply) => {
        try {
            const result = await failoverService.validateTopology();
            return result;
        }
        catch (error) {
            return reply.code(500).send({
                valid: false,
                errors: [error instanceof Error ? error.message : 'Unknown error'],
                warnings: [],
            });
        }
    });
}
//# sourceMappingURL=failover.js.map