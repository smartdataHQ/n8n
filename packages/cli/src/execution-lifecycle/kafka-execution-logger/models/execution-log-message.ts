import type { WorkflowExecuteMode } from 'n8n-workflow';

/**
 * Segment.com Track Event format with Context Suite Extensions
 * for n8n workflow execution logging
 */
export interface ExecutionLogMessage {
	// Segment.com standard fields
	type: 'track';
	event: 'Workflow Started' | 'Workflow Completed' | 'Workflow Failed' | 'Workflow Cancelled';
	userId?: string; // actual n8n user ID who triggered the workflow
	anonymousId?: string; // fallback if no userId available
	timestamp: string; // ISO 8601 format
	messageId: string; // random UUID for deduplication

	// Context Suite Extensions to Segment.com
	dimensions: {
		execution_mode: string; // 'manual', 'trigger', 'webhook', etc. (low cardinality)
		status?: string; // 'success', 'error', 'cancelled', 'waiting' (low cardinality)
		version?: string; // n8n version like '1.0.0' (low cardinality)
		environment?: string; // 'production', 'staging', 'development' (low cardinality)
		trigger_type?: string; // 'manual', 'schedule', 'webhook', etc. (low cardinality)
		workflow_name: string; // workflow names are typically low cardinality for BI breakdowns
		error_type?: string; // error categories like 'NodeOperationError', 'ValidationError' (low cardinality)
	};
	flags: {
		is_manual_execution: boolean;
		is_retry: boolean;
	};
	metrics: {
		duration_ms?: number;
		node_count: number;
	};
	tags: string[]; // workflow_tags?: string[];
	involves: [
		{
			role: 'WorkflowExecution';
			id: string; // executionId
			id_type: 'n8n';
		},
		{
			role: 'Workflow';
			id: string; // workflowId
			id_type: 'n8n';
		},
	];

	// Standard Segment.com properties object
	properties: {
		// High-cardinality identifiers (moved from dimensions)
		trigger_node?: string;
		retry_of?: string;

		// Timing
		started_at: string;
		finished_at?: string;

		// Error details (for failed executions)
		error_message?: string;
		error_stack?: string;
		error_node_id?: string;
		error_node_name?: string;

		workflow_version?: string; //number
	};

	// Segment.com context object
	context: {
		app: {
			name: 'n8n';
			version: string;
		};
		library: {
			name: 'n8n-kafka-execution-logger';
			version: string;
		};
		instance: {
			id: string;
			type: 'main' | 'worker';
		};
		// Additional n8n-specific context
		n8n: {
			execution_mode: WorkflowExecuteMode;
			instance_type: 'main' | 'worker';
		};
	};
}
