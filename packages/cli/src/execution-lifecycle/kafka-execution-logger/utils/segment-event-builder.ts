import type { WorkflowExecuteMode, IWorkflowBase } from 'n8n-workflow';
import { v4 as uuidv4 } from 'uuid';

import { N8N_VERSION } from '@/constants';

import type { ExecutionLogMessage } from '../models/execution-log-message';
import type { WorkflowExecutionContext } from '../services/kafka-execution-logger.interface';

/**
 * Utility class for building Segment.com track events from n8n workflow execution data
 */
export class SegmentEventBuilder {
	private static readonly LIBRARY_NAME = 'n8n-kafka-execution-logger';
	private static readonly LIBRARY_VERSION = '1.0.0';

	/**
	 * Build a Segment.com track event for workflow start
	 */
	static buildWorkflowStartEvent(context: WorkflowExecutionContext): ExecutionLogMessage {
		return this.buildBaseEvent(context, 'Workflow Started');
	}

	/**
	 * Build a Segment.com track event for workflow completion
	 */
	static buildWorkflowCompleteEvent(context: WorkflowExecutionContext): ExecutionLogMessage {
		const event = this.buildBaseEvent(context, 'Workflow Completed');

		// Add completion-specific data
		if (context.runData) {
			event.dimensions.status = this.mapExecutionStatus(context.runData.status);
			event.metrics.duration_ms = this.calculateDuration(context.startedAt, context.finishedAt);
		}

		return event;
	}

	/**
	 * Build a Segment.com track event for workflow error
	 */
	static buildWorkflowErrorEvent(context: WorkflowExecutionContext): ExecutionLogMessage {
		const event = this.buildBaseEvent(context, 'Workflow Failed');

		// Add error-specific data
		event.dimensions.status = 'error';

		if (context.runData?.data?.resultData?.error) {
			const error = context.runData.data.resultData.error;
			event.properties.error_message = error.message;
			event.properties.error_stack = error.stack;
			event.dimensions.error_type = this.categorizeError(error);

			// Extract node-specific error information (only available on NodeError types)
			if ('node' in error && error.node) {
				event.properties.error_node_id = error.node.id;
				event.properties.error_node_name = error.node.name;
			}
		}

		if (context.runData) {
			event.metrics.duration_ms = this.calculateDuration(context.startedAt, context.finishedAt);
		}

		return event;
	}

	/**
	 * Build a Segment.com track event for workflow cancellation
	 */
	static buildWorkflowCancelEvent(context: WorkflowExecutionContext): ExecutionLogMessage {
		const event = this.buildBaseEvent(context, 'Workflow Cancelled');

		// Add cancellation-specific data
		event.dimensions.status = 'cancelled';

		if (context.runData) {
			event.metrics.duration_ms = this.calculateDuration(context.startedAt, context.finishedAt);
		}

		return event;
	}

	/**
	 * Build the base Segment.com track event structure
	 */
	private static buildBaseEvent(
		context: WorkflowExecutionContext,
		eventName: ExecutionLogMessage['event'],
	): ExecutionLogMessage {
		const timestamp = new Date().toISOString();
		const messageId = uuidv4();

		return {
			// Segment.com standard fields
			type: 'track',
			event: eventName,
			userId: context.userId,
			anonymousId: context.userId ? undefined : this.generateAnonymousId(context.executionId),
			timestamp,
			messageId,

			// Context Suite Extensions
			dimensions: {
				execution_mode: this.mapExecutionMode(context.mode),
				version: N8N_VERSION,
				environment: this.getEnvironment(),
				trigger_type: this.determineTriggerType(context.workflowData, context.mode),
				workflow_name: context.workflowData.name || 'Unnamed Workflow',
			},
			flags: {
				is_manual_execution: this.isManualExecution(context.mode),
				is_retry: Boolean(context.retryOf),
			},
			metrics: {
				node_count: context.workflowData.nodes?.length || 0,
			},
			tags: this.extractWorkflowTags(context.workflowData),
			involves: [
				{
					role: 'WorkflowExecution',
					id: context.executionId,
					id_type: 'n8n',
				},
				{
					role: 'Workflow',
					id: context.workflowData.id || '',
					id_type: 'n8n',
				},
			],

			// Standard Segment.com properties
			properties: {
				trigger_node: this.findTriggerNode(context.workflowData),
				retry_of: context.retryOf,
				started_at: context.startedAt?.toISOString() || timestamp,
				finished_at: context.finishedAt?.toISOString(),
				workflow_version: context.workflowData.versionId?.toString(),
			},

			// Segment.com context object
			context: {
				app: {
					name: 'n8n',
					version: N8N_VERSION,
				},
				library: {
					name: this.LIBRARY_NAME,
					version: this.LIBRARY_VERSION,
				},
				instance: {
					id: this.getInstanceId(),
					type: this.getInstanceType(),
				},
				n8n: {
					execution_mode: context.mode,
					instance_type: this.getInstanceType(),
				},
			},
		};
	}

	/**
	 * Map n8n execution mode to human-readable string
	 */
	private static mapExecutionMode(mode: WorkflowExecuteMode): string {
		const modeMap: Record<WorkflowExecuteMode, string> = {
			manual: 'manual',
			trigger: 'trigger',
			webhook: 'webhook',
			error: 'error',
			retry: 'retry',
			integrated: 'integrated',
			cli: 'cli',
			internal: 'internal',
			evaluation: 'evaluation',
		};
		return modeMap[mode] || mode;
	}

	/**
	 * Map n8n execution status to standardized status
	 */
	private static mapExecutionStatus(status?: string): string {
		if (!status) return 'unknown';

		const statusMap: Record<string, string> = {
			success: 'success',
			error: 'error',
			canceled: 'cancelled',
			cancelled: 'cancelled',
			crashed: 'error',
			waiting: 'waiting',
			running: 'running',
		};

		return statusMap[status] || status;
	}

	/**
	 * Determine if execution is manual
	 */
	private static isManualExecution(mode: WorkflowExecuteMode): boolean {
		return mode === 'manual';
	}

	/**
	 * Determine trigger type from workflow data and execution mode
	 */
	private static determineTriggerType(
		workflowData: IWorkflowBase,
		mode: WorkflowExecuteMode,
	): string {
		if (mode === 'manual') return 'manual';
		if (mode === 'webhook') return 'webhook';
		if (mode === 'cli') return 'cli';

		// Try to determine from trigger nodes
		const triggerNode = workflowData.nodes?.find(
			(node) => node.type.includes('trigger') || node.type.includes('Trigger'),
		);

		if (triggerNode) {
			if (triggerNode.type.includes('cron') || triggerNode.type.includes('schedule')) {
				return 'schedule';
			}
			if (triggerNode.type.includes('webhook')) {
				return 'webhook';
			}
			return 'trigger';
		}

		return mode;
	}

	/**
	 * Find the trigger node name in the workflow
	 */
	private static findTriggerNode(workflowData: IWorkflowBase): string | undefined {
		const triggerNode = workflowData.nodes?.find(
			(node) => node.type.includes('trigger') || node.type.includes('Trigger'),
		);
		return triggerNode?.name;
	}

	/**
	 * Calculate duration between start and end times
	 */
	private static calculateDuration(startedAt?: Date, finishedAt?: Date): number | undefined {
		if (!startedAt || !finishedAt) return undefined;
		return finishedAt.getTime() - startedAt.getTime();
	}

	/**
	 * Categorize error types for better analytics
	 */
	private static categorizeError(error: unknown): string {
		if (!error) return 'Unknown';

		const errorName = (error as Error).name || (error as any).constructor?.name || '';
		const errorMessage = (error as Error).message || '';

		// Common n8n error patterns
		if (errorName.includes('NodeOperationError')) return 'NodeOperationError';
		if (errorName.includes('ValidationError')) return 'ValidationError';
		if (errorName.includes('ConnectionError')) return 'ConnectionError';
		if (errorName.includes('AuthenticationError')) return 'AuthenticationError';
		if (errorName.includes('TimeoutError')) return 'TimeoutError';

		// HTTP-related errors
		if (errorMessage.includes('ECONNREFUSED')) return 'ConnectionRefused';
		if (errorMessage.includes('ETIMEDOUT')) return 'Timeout';
		if (errorMessage.includes('ENOTFOUND')) return 'DNSError';

		// Generic categorization
		if (errorName.includes('Error')) return String(errorName);

		return 'Unknown';
	}

	/**
	 * Generate anonymous ID for users without userId
	 */
	private static generateAnonymousId(executionId: string): string {
		// Use execution ID as base for anonymous ID to maintain some consistency
		return `anon_${executionId.substring(0, 8)}`;
	}

	/**
	 * Get current environment
	 */
	private static getEnvironment(): string {
		return process.env.NODE_ENV || process.env.ENVIRONMENT || 'development';
	}

	/**
	 * Get instance ID (could be hostname, container ID, etc.)
	 */
	private static getInstanceId(): string {
		return process.env.HOSTNAME || process.env.INSTANCE_ID || 'unknown';
	}

	/**
	 * Get instance type (main or worker)
	 */
	private static getInstanceType(): 'main' | 'worker' {
		// This could be determined by checking if we're in a worker process
		// For now, default to 'main' - this should be configurable
		return process.env.N8N_PROCESS_TYPE === 'worker' ? 'worker' : 'main';
	}

	/**
	 * Generate message ID for Segment.com deduplication
	 */
	static generateMessageId(): string {
		return uuidv4();
	}

	/**
	 * Format timestamp in ISO 8601 format
	 */
	static formatTimestamp(date?: Date): string {
		return (date || new Date()).toISOString();
	}

	/**
	 * Extract workflow tags from workflow data
	 */
	static extractWorkflowTags(workflowData: IWorkflowBase): string[] {
		// IWorkflowBase doesn't have tags property, return empty array
		// Tags might be available on extended workflow interfaces
		return [];
	}

	/**
	 * Validate that the event conforms to Segment.com track event format
	 */
	static validateEvent(event: ExecutionLogMessage): boolean {
		// Check required Segment.com fields
		if (event.type !== 'track') return false;
		if (!event.event) return false;
		if (!event.timestamp) return false;
		if (!event.messageId) return false;

		// Must have either userId or anonymousId
		if (!event.userId && !event.anonymousId) return false;

		// Validate timestamp format (ISO 8601)
		const date = new Date(event.timestamp);
		if (isNaN(date.getTime())) {
			return false;
		}

		// Validate messageId format (UUID)
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(event.messageId)) return false;

		return true;
	}
}
