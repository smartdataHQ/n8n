import type { ExecutionLifecycleHooks } from 'n8n-core';
import type { IWorkflowBase, WorkflowExecuteMode, IRun, IDataObject } from 'n8n-workflow';

/**
 * Context object passed to execution event handlers
 */
export interface WorkflowExecutionContext {
	executionId: string;
	workflowData: IWorkflowBase;
	mode: WorkflowExecuteMode;
	userId?: string;
	runData?: IRun;
	newStaticData?: IDataObject;
	retryOf?: string;
	startedAt?: Date;
	finishedAt?: Date;
}

/**
 * Main interface for the Kafka Execution Logger service
 */
export interface IKafkaExecutionLogger {
	/**
	 * Initialize the service and register execution lifecycle hooks
	 * @throws Error if initialization fails
	 */
	initialize(): Promise<void>;

	/**
	 * Shutdown the service and cleanup resources
	 */
	shutdown(): Promise<void>;

	/**
	 * Register lifecycle hooks with the provided ExecutionLifecycleHooks instance
	 * @param hooks ExecutionLifecycleHooks instance to register with
	 */
	registerLifecycleHooks(hooks: ExecutionLifecycleHooks): void;

	/**
	 * Handle workflow execution start event
	 * @param context Workflow execution context
	 */
	handleWorkflowStart(context: WorkflowExecutionContext): Promise<void>;

	/**
	 * Handle workflow execution completion event
	 * @param context Workflow execution context
	 */
	handleWorkflowComplete(context: WorkflowExecutionContext): Promise<void>;

	/**
	 * Handle workflow execution error event
	 * @param context Workflow execution context
	 */
	handleWorkflowError(context: WorkflowExecutionContext): Promise<void>;
}
