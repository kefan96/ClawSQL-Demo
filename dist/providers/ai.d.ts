/**
 * AI Provider
 *
 * Provides AI integration for topology analysis, recommendations,
 * and natural language interface.
 */
import type { Topology, TopologyAnalysis } from '../types/topology.js';
import type { FailoverCandidate, SwitchoverCheck } from '../types/failover.js';
import type { ClusterEvent } from '../types/events.js';
import type { AIConfig } from '../types/config.js';
import type { SQLGenerationRequest, SQLGenerationResult } from '../types/sql.js';
interface FailoverRecommendation {
    recommendedHost: string;
    confidence: number;
    reasoning: string;
    alternatives: Array<{
        host: string;
        reason: string;
    }>;
}
interface ParsedCommand {
    intent: 'switchover' | 'failover' | 'status' | 'analyze' | 'unknown';
    target?: string;
    parameters: Record<string, string>;
    confidence: number;
}
export declare class AIProvider {
    private config;
    private anthropicClient;
    private openaiClient;
    constructor(config: AIConfig);
    private initClient;
    /**
     * Generate a response using the configured AI provider
     */
    private generate;
    /**
     * Analyze topology and provide insights
     */
    analyzeTopology(topology: Topology): Promise<TopologyAnalysis>;
    /**
     * Basic analysis without AI
     */
    private basicAnalysis;
    /**
     * Recommend the best replica for failover
     */
    recommendFailover(topology: Topology, candidates: FailoverCandidate[]): Promise<FailoverRecommendation>;
    /**
     * Basic recommendation without AI
     */
    private basicRecommendation;
    /**
     * Parse a natural language command
     */
    parseCommand(query: string): Promise<ParsedCommand>;
    /**
     * Basic command parsing without AI
     */
    private basicParseCommand;
    /**
     * Explain an event in natural language
     */
    explainEvent(event: ClusterEvent): Promise<string>;
    /**
     * Generate a cluster status report
     */
    generateReport(topology: Topology): Promise<string>;
    /**
     * Basic report without AI
     */
    private basicReport;
    /**
     * Validate a switchover operation
     */
    validateSwitchover(check: SwitchoverCheck, current: string, target: string): Promise<{
        valid: boolean;
        warnings: string[];
        advice: string;
    }>;
    /**
     * Generate SQL from natural language
     */
    generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResult>;
    /**
     * Build RAG context section with similar queries and table contexts
     */
    private buildRAGContextSection;
    /**
     * Build schema context for the AI prompt
     */
    private buildSchemaContext;
    /**
     * Check if SQL is safe to execute
     */
    private isSQLSafe;
}
export declare function getAIProvider(config?: AIConfig): AIProvider;
export declare function resetAIProvider(): void;
export {};
//# sourceMappingURL=ai.d.ts.map