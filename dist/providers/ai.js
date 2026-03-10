/**
 * AI Provider
 *
 * Provides AI integration for topology analysis, recommendations,
 * and natural language interface.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getLogger } from '../logger.js';
const log = getLogger('ai-provider');
export class AIProvider {
    config;
    anthropicClient = null;
    openaiClient = null;
    constructor(config) {
        this.config = config;
        this.initClient();
    }
    initClient() {
        if (!this.config.apiKey) {
            log.warn('No API key provided, AI features will be limited');
            return;
        }
        if (this.config.provider === 'anthropic') {
            this.anthropicClient = new Anthropic({
                apiKey: this.config.apiKey,
                baseURL: this.config.baseURL,
            });
        }
        else {
            this.openaiClient = new OpenAI({
                apiKey: this.config.apiKey,
                baseURL: this.config.baseURL,
            });
        }
    }
    /**
     * Generate a response using the configured AI provider
     */
    async generate(prompt) {
        if (!this.config.apiKey) {
            return 'AI features require an API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.';
        }
        try {
            if (this.config.provider === 'anthropic' && this.anthropicClient) {
                const response = await this.anthropicClient.messages.create({
                    model: this.config.model,
                    max_tokens: 2048,
                    messages: [{ role: 'user', content: prompt }],
                });
                // Find the text block (Qwen/DashScope may have "thinking" blocks first)
                const textBlock = response.content.find(block => block.type === 'text');
                if (textBlock && textBlock.type === 'text') {
                    return textBlock.text;
                }
                return 'No response generated';
            }
            else if (this.openaiClient) {
                const response = await this.openaiClient.chat.completions.create({
                    model: this.config.model,
                    max_tokens: 2048,
                    messages: [{ role: 'user', content: prompt }],
                });
                return response.choices[0]?.message?.content ?? 'No response generated';
            }
            return 'No AI client configured';
        }
        catch (error) {
            log.error({ error }, 'AI generation failed');
            throw error;
        }
    }
    // ─── Topology Analysis ──────────────────────────────────────────────────
    /**
     * Analyze topology and provide insights
     */
    async analyzeTopology(topology) {
        if (!this.config.features.analysis) {
            return this.basicAnalysis(topology);
        }
        const prompt = `Analyze this MySQL cluster topology and provide insights:

Cluster: ${topology.clusterName}
Primary: ${topology.primary ? `${topology.primary.host}:${topology.primary.port}` : 'None'}
Replicas: ${topology.replicas.map(r => `${r.host}:${r.port} (server_id=${r.serverId})`).join(', ')}
Problems: ${topology.problems.length > 0 ? topology.problems.map(p => `${p.type}: ${p.message}`).join('; ') : 'None'}

Provide a JSON response with:
1. healthy (boolean): Is the cluster healthy?
2. riskLevel ("low" | "medium" | "high"): Risk assessment
3. recommendations (string[]): Actionable recommendations
4. concerns (string[]): Any concerns about the current state

Respond only with valid JSON.`;
        try {
            const response = await this.generate(prompt);
            const parsed = JSON.parse(response);
            return {
                healthy: parsed.healthy,
                primary: topology.primary ? `${topology.primary.host}:${topology.primary.port}` : null,
                replicaCount: topology.replicas.length,
                problems: topology.problems,
                recommendations: parsed.recommendations,
                riskLevel: parsed.riskLevel,
            };
        }
        catch (error) {
            log.warn({ error }, 'AI analysis failed, falling back to basic analysis');
            return this.basicAnalysis(topology);
        }
    }
    /**
     * Basic analysis without AI
     */
    basicAnalysis(topology) {
        const recommendations = [];
        let riskLevel = 'low';
        if (!topology.primary) {
            recommendations.push('No primary detected - immediate attention required');
            riskLevel = 'critical';
        }
        if (topology.replicas.length === 0) {
            recommendations.push('No replicas available - no redundancy for failover');
            riskLevel = 'high';
        }
        if (topology.problems.length > 0) {
            for (const problem of topology.problems) {
                if (problem.severity === 'critical' || problem.severity === 'error') {
                    riskLevel = 'high';
                }
                else if (problem.severity === 'warning' && riskLevel !== 'high') {
                    riskLevel = 'medium';
                }
                recommendations.push(`Address ${problem.type}: ${problem.message}`);
            }
        }
        return {
            healthy: topology.problems.length === 0 && topology.primary !== null,
            primary: topology.primary ? `${topology.primary.host}:${topology.primary.port}` : null,
            replicaCount: topology.replicas.length,
            problems: topology.problems,
            recommendations,
            riskLevel,
        };
    }
    // ─── Failover Recommendations ────────────────────────────────────────────
    /**
     * Recommend the best replica for failover
     */
    async recommendFailover(topology, candidates) {
        if (!this.config.features.recommendations || candidates.length === 0) {
            return this.basicRecommendation(candidates);
        }
        const prompt = `Given these MySQL failover candidates, recommend the best one:

Current Primary: ${topology.primary ? `${topology.primary.host}:${topology.primary.port}` : 'Failed'}
Candidates:
${candidates.map(c => `- ${c.host}:${c.port}: score=${c.score}, lag=${c.lag}s, healthy=${c.healthy}, GTID=${c.gtidPosition.slice(0, 50)}...`).join('\n')}

Provide a JSON response with:
1. recommendedHost (string): The best candidate hostname
2. confidence (number 0-1): Confidence in recommendation
3. reasoning (string): Why this candidate is recommended
4. alternatives (array): Other viable options with reasons

Respond only with valid JSON.`;
        try {
            const response = await this.generate(prompt);
            return JSON.parse(response);
        }
        catch (error) {
            log.warn({ error }, 'AI recommendation failed, falling back to basic selection');
            return this.basicRecommendation(candidates);
        }
    }
    /**
     * Basic recommendation without AI
     */
    basicRecommendation(candidates) {
        // Sort by score (higher is better), then by lag (lower is better)
        const sorted = [...candidates]
            .filter(c => c.healthy)
            .sort((a, b) => {
            if (b.score !== a.score)
                return b.score - a.score;
            return a.lag - b.lag;
        });
        const best = sorted[0];
        if (!best) {
            return {
                recommendedHost: candidates[0]?.host ?? 'none',
                confidence: 0,
                reasoning: 'No healthy candidates available',
                alternatives: [],
            };
        }
        return {
            recommendedHost: `${best.host}:${best.port}`,
            confidence: 0.8,
            reasoning: `Best score (${best.score}) and lowest lag (${best.lag}s) among healthy replicas`,
            alternatives: sorted.slice(1, 3).map(c => ({
                host: `${c.host}:${c.port}`,
                reason: `Score: ${c.score}, Lag: ${c.lag}s`,
            })),
        };
    }
    // ─── Natural Language Interface ──────────────────────────────────────────
    /**
     * Parse a natural language command
     */
    async parseCommand(query) {
        if (!this.config.features.naturalLanguage) {
            return this.basicParseCommand(query);
        }
        const prompt = `Parse this MySQL cluster management command:

"${query}"

Respond with a JSON object containing:
1. intent: One of "switchover", "failover", "status", "analyze", "unknown"
2. target: Target hostname if mentioned (optional)
3. parameters: Any other parameters extracted (object)
4. confidence: Number between 0 and 1

Examples:
- "switch to replica 1" -> {"intent":"switchover","target":"replica-1","parameters":{},"confidence":0.9}
- "show me the topology" -> {"intent":"status","target":null,"parameters":{},"confidence":0.95}
- "what's wrong with the cluster" -> {"intent":"analyze","target":null,"parameters":{},"confidence":0.9}

Respond only with valid JSON.`;
        try {
            const response = await this.generate(prompt);
            return JSON.parse(response);
        }
        catch (error) {
            log.warn({ error }, 'AI parsing failed, falling back to basic parsing');
            return this.basicParseCommand(query);
        }
    }
    /**
     * Basic command parsing without AI
     */
    basicParseCommand(query) {
        const lower = query.toLowerCase();
        if (lower.includes('switch') || lower.includes('promote')) {
            const hostMatch = query.match(/(?:to\s+)?(\S+)/i);
            return {
                intent: 'switchover',
                target: hostMatch?.[1],
                parameters: {},
                confidence: 0.6,
            };
        }
        if (lower.includes('failover') || lower.includes('emergency')) {
            return {
                intent: 'failover',
                parameters: {},
                confidence: 0.7,
            };
        }
        if (lower.includes('status') || lower.includes('topology') || lower.includes('show')) {
            return {
                intent: 'status',
                parameters: {},
                confidence: 0.8,
            };
        }
        if (lower.includes('analyze') || lower.includes('wrong') || lower.includes('problem')) {
            return {
                intent: 'analyze',
                parameters: {},
                confidence: 0.7,
            };
        }
        return {
            intent: 'unknown',
            parameters: {},
            confidence: 0.3,
        };
    }
    // ─── Event Explanation ────────────────────────────────────────────────────
    /**
     * Explain an event in natural language
     */
    async explainEvent(event) {
        const prompt = `Explain this MySQL cluster event in plain language:

Event: ${event.type}
Cluster: ${event.cluster}
Severity: ${event.severity}
Message: ${event.message}
Details: ${JSON.stringify(event.details)}

Provide a clear, concise explanation (2-3 sentences) suitable for an operations team.`;
        try {
            return await this.generate(prompt);
        }
        catch (error) {
            log.warn({ error }, 'AI explanation failed');
            return `${event.type}: ${event.message}`;
        }
    }
    /**
     * Generate a cluster status report
     */
    async generateReport(topology) {
        const prompt = `Generate a status report for this MySQL cluster:

Cluster: ${topology.clusterName}
Primary: ${topology.primary ? `${topology.primary.host}:${topology.primary.port}` : 'None'}
Replicas: ${topology.replicas.map(r => `${r.host}:${r.port}`).join(', ')}
Problems: ${topology.problems.length}

Format as a concise summary with:
- Overall health status
- Key metrics
- Any issues or recommendations

Keep it under 200 words.`;
        try {
            return await this.generate(prompt);
        }
        catch (error) {
            log.warn({ error }, 'AI report generation failed');
            return this.basicReport(topology);
        }
    }
    /**
     * Basic report without AI
     */
    basicReport(topology) {
        const lines = [
            `# ${topology.clusterName} Status Report`,
            ``,
            `**Primary:** ${topology.primary ? `${topology.primary.host}:${topology.primary.port}` : 'None'}`,
            `**Replicas:** ${topology.replicas.length}`,
            `**Health:** ${topology.problems.length === 0 ? 'Healthy' : `${topology.problems.length} problem(s)`}`,
        ];
        if (topology.problems.length > 0) {
            lines.push(``, `**Issues:**`);
            for (const p of topology.problems) {
                lines.push(`- ${p.type}: ${p.message}`);
            }
        }
        return lines.join('\n');
    }
    /**
     * Validate a switchover operation
     */
    async validateSwitchover(check, current, target) {
        if (!check.canSwitchover) {
            return {
                valid: false,
                warnings: check.reasons,
                advice: `Cannot perform switchover: ${check.reasons.join(', ')}`,
            };
        }
        const prompt = `A MySQL switchover is being planned from ${current} to ${target}.

Pre-check results:
- Can switchover: ${check.canSwitchover}
- Warnings: ${check.warnings.join(', ') || 'None'}
- Suggested target: ${check.suggestedTarget ?? 'N/A'}

Provide a JSON response with:
1. valid (boolean): Should the switchover proceed?
2. warnings (string[]): Any warnings to display
3. advice (string): Brief advice for the operation

Respond only with valid JSON.`;
        try {
            const response = await this.generate(prompt);
            return JSON.parse(response);
        }
        catch {
            return {
                valid: check.canSwitchover,
                warnings: check.warnings,
                advice: `Switchover from ${current} to ${target} is ready to proceed.`,
            };
        }
    }
    // ─── SQL Generation ────────────────────────────────────────────────────────
    /**
     * Generate SQL from natural language
     */
    async generateSQL(request) {
        const schemaContext = this.buildSchemaContext(request.schema, request.database);
        const ragContext = this.buildRAGContextSection(request.similarQueries, request.tableContexts);
        const readOnlyHint = request.readOnly !== false
            ? 'IMPORTANT: Only generate SELECT queries. No INSERT, UPDATE, DELETE, or DDL statements allowed.'
            : 'You may generate SELECT, INSERT, UPDATE, or DELETE queries as appropriate.';
        const prompt = `You are a SQL expert. Generate a MySQL query from the following natural language request.

${schemaContext}
${ragContext}
Natural Language Request: "${request.query}"

${readOnlyHint}

Rules:
1. Generate valid MySQL syntax
2. Use proper table and column names from the schema
3. Add appropriate WHERE clauses for filtering
4. Include LIMIT clause if the query might return many rows
5. Use proper JOIN syntax when querying multiple tables
6. Quote string literals with single quotes
7. Use backticks for table/column names that might be reserved words
8. Learn from similar past queries - especially note any user corrections

Respond with a JSON object containing:
1. "sql": The generated SQL query (string)
2. "explanation": Brief explanation of what the query does (string)
3. "isSafe": Whether this query is safe to execute (boolean)
4. "warnings": Array of any warnings or concerns (string[], optional)
5. "confidence": Confidence level from 0 to 1 (number)

Example response:
{"sql": "SELECT * FROM users WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) LIMIT 100", "explanation": "Selects all users created in the last 7 days, limited to 100 rows.", "isSafe": true, "warnings": [], "confidence": 0.9}

Respond only with valid JSON.`;
        try {
            const response = await this.generate(prompt);
            const result = JSON.parse(response);
            // Validate and sanitize
            result.warnings = result.warnings || [];
            result.isSafe = result.isSafe && this.isSQLSafe(result.sql, request.readOnly !== false);
            // Store confidence if provided
            result.confidence = result.confidence || 0.7;
            return result;
        }
        catch (error) {
            log.warn({ error }, 'AI SQL generation failed');
            return {
                sql: '',
                explanation: 'Failed to generate SQL from the request.',
                isSafe: false,
                warnings: ['AI SQL generation failed. Please try again or write SQL manually.'],
            };
        }
    }
    /**
     * Build RAG context section with similar queries and table contexts
     */
    buildRAGContextSection(similarQueries, tableContexts) {
        const sections = [];
        // Add similar queries from history
        if (similarQueries && similarQueries.length > 0) {
            sections.push('## Similar Past Queries (learn from these):');
            sections.push('');
            for (const q of similarQueries) {
                sections.push(`- "${q.naturalLanguage}" → ${q.sql}`);
                if (q.correctedSQL) {
                    sections.push(`  ⚠️ User corrected to: ${q.correctedSQL}`);
                }
                sections.push('');
            }
        }
        // Add business context for tables
        if (tableContexts && tableContexts.length > 0) {
            sections.push('## Table Business Context:');
            sections.push('');
            for (const ctx of tableContexts) {
                sections.push(`### ${ctx.table}`);
                if (ctx.description) {
                    sections.push(`Description: ${ctx.description}`);
                }
                if (ctx.businessNotes) {
                    sections.push(`Notes: ${ctx.businessNotes}`);
                }
                if (ctx.exampleQueries && ctx.exampleQueries.length > 0) {
                    sections.push('Example queries:');
                    for (const ex of ctx.exampleQueries) {
                        sections.push(`  - ${ex}`);
                    }
                }
                sections.push('');
            }
        }
        return sections.length > 0 ? sections.join('\n') : '';
    }
    /**
     * Build schema context for the AI prompt
     */
    buildSchemaContext(schema, database) {
        if (!schema || schema.tables.length === 0) {
            return 'No database schema information available.';
        }
        const lines = [`Database: ${database || schema.database}`, '', 'Tables:'];
        for (const table of schema.tables) {
            lines.push(`\n${table.name}:`);
            for (const col of table.columns) {
                const keyInfo = col.key ? ` [${col.key}]` : '';
                const nullInfo = col.nullable ? '' : ' NOT NULL';
                lines.push(`  - ${col.name}: ${col.type}${nullInfo}${keyInfo}`);
            }
        }
        return lines.join('\n');
    }
    /**
     * Check if SQL is safe to execute
     */
    isSQLSafe(sql, readOnly) {
        const normalizedSQL = sql.trim().toUpperCase();
        // Check for dangerous patterns
        const dangerousPatterns = [
            /;\s*DROP/i,
            /;\s*DELETE/i,
            /;\s*TRUNCATE/i,
            /;\s*ALTER/i,
            /;\s*GRANT/i,
            /;\s*REVOKE/i,
        ];
        for (const pattern of dangerousPatterns) {
            if (pattern.test(sql)) {
                return false;
            }
        }
        // If read-only, check for write operations
        if (readOnly) {
            const writePatterns = [
                /^\s*INSERT/i,
                /^\s*UPDATE/i,
                /^\s*DELETE/i,
                /^\s*REPLACE/i,
                /^\s*CREATE/i,
                /^\s*ALTER/i,
                /^\s*DROP/i,
                /^\s*TRUNCATE/i,
            ];
            for (const pattern of writePatterns) {
                if (pattern.test(sql)) {
                    return false;
                }
            }
        }
        return true;
    }
}
// Singleton instance
let _provider = null;
export function getAIProvider(config) {
    if (!_provider && config) {
        _provider = new AIProvider(config);
    }
    if (!_provider) {
        throw new Error('AI provider not initialized');
    }
    return _provider;
}
export function resetAIProvider() {
    _provider = null;
}
//# sourceMappingURL=ai.js.map