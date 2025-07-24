import type { IWorkflowBase, WorkflowExecuteMode, IRun } from 'n8n-workflow';

import type { WorkflowExecutionContext } from '../services/kafka-execution-logger.interface';
import { SegmentEventBuilder } from '../utils/segment-event-builder';

// Mock uuid
jest.mock('uuid', () => ({
	v4: jest.fn(() => '550e8400-e29b-41d4-a716-446655440000'),
}));

// Mock constants
jest.mock('@/constants', () => ({
	N8N_VERSION: '1.0.0',
}));

describe('SegmentEventBuilder', () => {
	let mockWorkflowData: IWorkflowBase;
	let mockContext: WorkflowExecutionContext;

	beforeEach(() => {
		mockWorkflowData = {
			id: 'workflow-123',
			name: 'Test Workflow',
			nodes: [
				{
					id: 'node-1',
					name: 'Start',
					type: 'n8n-nodes-base.start',
					typeVersion: 1,
					position: [100, 100],
					parameters: {},
				},
				{
					id: 'node-2',
					name: 'HTTP Request',
					type: 'n8n-nodes-base.httpRequest',
					typeVersion: 1,
					position: [200, 200],
					parameters: {},
				},
			],
			connections: {},
			tags: ['test', 'automation'],
			versionId: 1,
		};

		mockContext = {
			executionId: 'exec-456',
			workflowData: mockWorkflowData,
			mode: 'manual' as WorkflowExecuteMode,
			userId: 'user-789',
			startedAt: new Date('2023-01-01T10:00:00.000Z'),
			finishedAt: new Date('2023-01-01T10:01:30.000Z'),
		};

		// Reset environment variables
		delete process.env.NODE_ENV;
		delete process.env.ENVIRONMENT;
		delete process.env.HOSTNAME;
		delete process.env.INSTANCE_ID;
		delete process.env.N8N_PROCESS_TYPE;
	});

	describe('buildWorkflowStartEvent', () => {
		it('should build a valid workflow start event', () => {
			const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);

			expect(event).toMatchObject({
				type: 'track',
				event: 'Workflow Started',
				userId: 'user-789',
				timestamp: expect.any(String),
				messageId: '550e8400-e29b-41d4-a716-446655440000',
				dimensions: {
					execution_mode: 'manual',
					version: '1.0.0',
					environment: 'development',
					trigger_type: 'manual',
					workflow_name: 'Test Workflow',
				},
				flags: {
					is_manual_execution: true,
					is_retry: false,
				},
				metrics: {
					node_count: 2,
				},
				tags: ['test', 'automation'],
				involves: [
					{
						role: 'WorkflowExecution',
						id: 'exec-456',
						id_type: 'n8n',
					},
					{
						role: 'Workflow',
						id: 'workflow-123',
						id_type: 'n8n',
					},
				],
				properties: {
					started_at: '2023-01-01T10:00:00.000Z',
					workflow_version: '1',
				},
				context: {
					app: {
						name: 'n8n',
						version: '1.0.0',
					},
					library: {
						name: 'n8n-kafka-execution-logger',
						version: '1.0.0',
					},
					instance: {
						id: 'unknown',
						type: 'main',
					},
					n8n: {
						execution_mode: 'manual',
						instance_type: 'main',
					},
				},
			});
		});

		it('should handle missing userId with anonymousId', () => {
			const contextWithoutUser = { ...mockContext, userId: undefined };
			const event = SegmentEventBuilder.buildWorkflowStartEvent(contextWithoutUser);

			expect(event.userId).toBeUndefined();
			expect(event.anonymousId).toBe('anon_exec-456');
		});

		it('should handle workflow without name', () => {
			const workflowWithoutName = { ...mockWorkflowData, name: undefined };
			const contextWithoutName = { ...mockContext, workflowData: workflowWithoutName };
			const event = SegmentEventBuilder.buildWorkflowStartEvent(contextWithoutName);

			expect(event.dimensions.workflow_name).toBe('Unnamed Workflow');
		});

		it('should handle retry execution', () => {
			const retryContext = { ...mockContext, retryOf: 'original-exec-123' };
			const event = SegmentEventBuilder.buildWorkflowStartEvent(retryContext);

			expect(event.flags.is_retry).toBe(true);
			expect(event.properties.retry_of).toBe('original-exec-123');
		});
	});

	describe('buildWorkflowCompleteEvent', () => {
		it('should build a valid workflow complete event', () => {
			const runData: IRun = {
				data: {
					resultData: {
						runData: {},
					},
					executionData: {
						contextData: {},
						nodeExecutionStack: [],
						metadata: {},
						waitingExecution: {},
						waitingExecutionSource: {},
					},
				},
				finished: true,
				mode: 'manual',
				status: 'success',
				startedAt: new Date('2023-01-01T10:00:00.000Z'),
				stoppedAt: new Date('2023-01-01T10:01:30.000Z'),
			};

			const contextWithRunData = { ...mockContext, runData };
			const event = SegmentEventBuilder.buildWorkflowCompleteEvent(contextWithRunData);

			expect(event.event).toBe('Workflow Completed');
			expect(event.dimensions.status).toBe('success');
			expect(event.metrics.duration_ms).toBe(90000); // 1.5 minutes
		});

		it('should handle different execution statuses', () => {
			const testCases = [
				{ status: 'success', expected: 'success' },
				{ status: 'error', expected: 'error' },
				{ status: 'canceled', expected: 'cancelled' },
				{ status: 'crashed', expected: 'error' },
				{ status: 'waiting', expected: 'waiting' },
			];

			testCases.forEach(({ status, expected }) => {
				const runData: IRun = {
					data: {
						resultData: { runData: {} },
						executionData: {
							contextData: {},
							nodeExecutionStack: [],
							metadata: {},
							waitingExecution: {},
							waitingExecutionSource: {},
						},
					},
					finished: true,
					mode: 'manual',
					status: status as any,
					startedAt: new Date(),
				};

				const contextWithRunData = { ...mockContext, runData };
				const event = SegmentEventBuilder.buildWorkflowCompleteEvent(contextWithRunData);

				expect(event.dimensions.status).toBe(expected);
			});
		});
	});

	describe('buildWorkflowErrorEvent', () => {
		it('should build a valid workflow error event with error details', () => {
			const error = {
				name: 'NodeOperationError',
				message: 'HTTP request failed',
				stack: 'Error: HTTP request failed\n    at ...',
				node: {
					id: 'node-2',
					name: 'HTTP Request',
				},
			};

			const runData: IRun = {
				data: {
					resultData: {
						runData: {},
						error,
					},
					executionData: {
						contextData: {},
						nodeExecutionStack: [],
						metadata: {},
						waitingExecution: {},
						waitingExecutionSource: {},
					},
				},
				finished: true,
				mode: 'manual',
				status: 'error',
				startedAt: new Date('2023-01-01T10:00:00.000Z'),
				stoppedAt: new Date('2023-01-01T10:01:30.000Z'),
			};

			const contextWithError = { ...mockContext, runData };
			const event = SegmentEventBuilder.buildWorkflowErrorEvent(contextWithError);

			expect(event.event).toBe('Workflow Failed');
			expect(event.dimensions.status).toBe('error');
			expect(event.dimensions.error_type).toBe('NodeOperationError');
			expect(event.properties.error_message).toBe('HTTP request failed');
			expect(event.properties.error_stack).toBe('Error: HTTP request failed\n    at ...');
			expect(event.properties.error_node_id).toBe('node-2');
			expect(event.properties.error_node_name).toBe('HTTP Request');
			expect(event.metrics.duration_ms).toBe(90000);
		});

		it('should categorize different error types', () => {
			const testCases = [
				{ name: 'NodeOperationError', expected: 'NodeOperationError' },
				{ name: 'ValidationError', expected: 'ValidationError' },
				{ name: 'ConnectionError', expected: 'ConnectionError' },
				{ name: 'AuthenticationError', expected: 'AuthenticationError' },
				{ name: 'TimeoutError', expected: 'TimeoutError' },
				{ message: 'ECONNREFUSED', expected: 'ConnectionRefused' },
				{ message: 'ETIMEDOUT', expected: 'Timeout' },
				{ message: 'ENOTFOUND', expected: 'DNSError' },
				{ name: 'CustomError', expected: 'CustomError' },
				{ name: undefined, message: undefined, expected: 'Unknown' },
			];

			testCases.forEach(({ name, message, expected }) => {
				const error = { name, message: message || 'Test error' };
				const runData: IRun = {
					data: {
						resultData: { runData: {}, error },
						executionData: {
							contextData: {},
							nodeExecutionStack: [],
							metadata: {},
							waitingExecution: {},
							waitingExecutionSource: {},
						},
					},
					finished: true,
					mode: 'manual',
					status: 'error',
					startedAt: new Date(),
				};

				const contextWithError = { ...mockContext, runData };
				const event = SegmentEventBuilder.buildWorkflowErrorEvent(contextWithError);

				expect(event.dimensions.error_type).toBe(expected);
			});
		});
	});

	describe('buildWorkflowCancelEvent', () => {
		it('should build a valid workflow cancel event', () => {
			const runData: IRun = {
				data: {
					resultData: { runData: {} },
					executionData: {
						contextData: {},
						nodeExecutionStack: [],
						metadata: {},
						waitingExecution: {},
						waitingExecutionSource: {},
					},
				},
				finished: true,
				mode: 'manual',
				status: 'canceled',
				startedAt: new Date('2023-01-01T10:00:00.000Z'),
				stoppedAt: new Date('2023-01-01T10:01:30.000Z'),
			};

			const contextWithRunData = { ...mockContext, runData };
			const event = SegmentEventBuilder.buildWorkflowCancelEvent(contextWithRunData);

			expect(event.event).toBe('Workflow Cancelled');
			expect(event.dimensions.status).toBe('cancelled');
			expect(event.metrics.duration_ms).toBe(90000);
		});
	});

	describe('execution mode mapping', () => {
		it('should map different execution modes correctly', () => {
			const testCases: Array<{
				mode: WorkflowExecuteMode;
				expected: string;
				triggerType: string;
				isManual: boolean;
			}> = [
				{ mode: 'manual', expected: 'manual', triggerType: 'manual', isManual: true },
				{ mode: 'trigger', expected: 'trigger', triggerType: 'trigger', isManual: false },
				{ mode: 'webhook', expected: 'webhook', triggerType: 'webhook', isManual: false },
				{ mode: 'error', expected: 'error', triggerType: 'error', isManual: false },
				{ mode: 'retry', expected: 'retry', triggerType: 'retry', isManual: false },
				{ mode: 'integrated', expected: 'integrated', triggerType: 'integrated', isManual: false },
				{ mode: 'cli', expected: 'cli', triggerType: 'cli', isManual: false },
			];

			testCases.forEach(({ mode, expected, triggerType, isManual }) => {
				const contextWithMode = { ...mockContext, mode };
				const event = SegmentEventBuilder.buildWorkflowStartEvent(contextWithMode);

				expect(event.dimensions.execution_mode).toBe(expected);
				expect(event.dimensions.trigger_type).toBe(triggerType);
				expect(event.flags.is_manual_execution).toBe(isManual);
			});
		});
	});

	describe('trigger type detection', () => {
		it('should detect schedule trigger from node type', () => {
			const workflowWithScheduleTrigger = {
				...mockWorkflowData,
				nodes: [
					{
						id: 'trigger-1',
						name: 'Schedule Trigger',
						type: 'n8n-nodes-base.cronTrigger',
						typeVersion: 1,
						position: [100, 100],
						parameters: {},
					},
				],
			};

			const contextWithSchedule = {
				...mockContext,
				workflowData: workflowWithScheduleTrigger,
				mode: 'trigger' as WorkflowExecuteMode,
			};

			const event = SegmentEventBuilder.buildWorkflowStartEvent(contextWithSchedule);
			expect(event.dimensions.trigger_type).toBe('schedule');
			expect(event.properties.trigger_node).toBe('Schedule Trigger');
		});

		it('should detect webhook trigger from node type', () => {
			const workflowWithWebhookTrigger = {
				...mockWorkflowData,
				nodes: [
					{
						id: 'trigger-1',
						name: 'Webhook Trigger',
						type: 'n8n-nodes-base.webhookTrigger',
						typeVersion: 1,
						position: [100, 100],
						parameters: {},
					},
				],
			};

			const contextWithWebhook = {
				...mockContext,
				workflowData: workflowWithWebhookTrigger,
				mode: 'webhook' as WorkflowExecuteMode,
			};

			const event = SegmentEventBuilder.buildWorkflowStartEvent(contextWithWebhook);
			expect(event.dimensions.trigger_type).toBe('webhook');
			expect(event.properties.trigger_node).toBe('Webhook Trigger');
		});
	});

	describe('environment detection', () => {
		it('should detect environment from NODE_ENV', () => {
			process.env.NODE_ENV = 'production';
			const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
			expect(event.dimensions.environment).toBe('production');
		});

		it('should detect environment from ENVIRONMENT', () => {
			process.env.ENVIRONMENT = 'staging';
			const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
			expect(event.dimensions.environment).toBe('staging');
		});

		it('should default to development', () => {
			const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
			expect(event.dimensions.environment).toBe('development');
		});
	});

	describe('instance detection', () => {
		it('should detect instance ID from HOSTNAME', () => {
			process.env.HOSTNAME = 'n8n-server-1';
			const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
			expect(event.context.instance.id).toBe('n8n-server-1');
		});

		it('should detect instance ID from INSTANCE_ID', () => {
			process.env.INSTANCE_ID = 'instance-123';
			const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
			expect(event.context.instance.id).toBe('instance-123');
		});

		it('should detect worker instance type', () => {
			process.env.N8N_PROCESS_TYPE = 'worker';
			const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
			expect(event.context.instance.type).toBe('worker');
			expect(event.context.n8n.instance_type).toBe('worker');
		});

		it('should default to main instance type', () => {
			const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
			expect(event.context.instance.type).toBe('main');
			expect(event.context.n8n.instance_type).toBe('main');
		});
	});

	describe('utility methods', () => {
		describe('generateMessageId', () => {
			it('should generate a UUID', () => {
				const messageId = SegmentEventBuilder.generateMessageId();
				expect(messageId).toBe('550e8400-e29b-41d4-a716-446655440000');
			});
		});

		describe('formatTimestamp', () => {
			it('should format date to ISO string', () => {
				const date = new Date('2023-01-01T10:00:00.000Z');
				const timestamp = SegmentEventBuilder.formatTimestamp(date);
				expect(timestamp).toBe('2023-01-01T10:00:00.000Z');
			});

			it('should use current date if no date provided', () => {
				const timestamp = SegmentEventBuilder.formatTimestamp();
				expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
			});
		});

		describe('extractWorkflowTags', () => {
			it('should extract tags from workflow data', () => {
				const tags = SegmentEventBuilder.extractWorkflowTags(mockWorkflowData);
				expect(tags).toEqual(['test', 'automation']);
			});

			it('should return empty array if no tags', () => {
				const workflowWithoutTags = { ...mockWorkflowData, tags: undefined };
				const tags = SegmentEventBuilder.extractWorkflowTags(workflowWithoutTags);
				expect(tags).toEqual([]);
			});
		});

		describe('validateEvent', () => {
			it('should validate a correct event', () => {
				const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
				const isValid = SegmentEventBuilder.validateEvent(event);
				expect(isValid).toBe(true);
			});

			it('should reject event with wrong type', () => {
				const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
				event.type = 'identify' as any;
				const isValid = SegmentEventBuilder.validateEvent(event);
				expect(isValid).toBe(false);
			});

			it('should reject event without event name', () => {
				const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
				event.event = '' as any;
				const isValid = SegmentEventBuilder.validateEvent(event);
				expect(isValid).toBe(false);
			});

			it('should reject event without timestamp', () => {
				const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
				event.timestamp = '';
				const isValid = SegmentEventBuilder.validateEvent(event);
				expect(isValid).toBe(false);
			});

			it('should reject event without messageId', () => {
				const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
				event.messageId = '';
				const isValid = SegmentEventBuilder.validateEvent(event);
				expect(isValid).toBe(false);
			});

			it('should reject event without userId or anonymousId', () => {
				const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
				event.userId = undefined;
				event.anonymousId = undefined;
				const isValid = SegmentEventBuilder.validateEvent(event);
				expect(isValid).toBe(false);
			});

			it('should reject event with invalid timestamp', () => {
				const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
				event.timestamp = 'invalid-date';
				const isValid = SegmentEventBuilder.validateEvent(event);
				expect(isValid).toBe(false);
			});

			it('should reject event with invalid messageId format', () => {
				const event = SegmentEventBuilder.buildWorkflowStartEvent(mockContext);
				event.messageId = 'not-a-uuid';
				const isValid = SegmentEventBuilder.validateEvent(event);
				expect(isValid).toBe(false);
			});
		});
	});

	describe('edge cases', () => {
		it('should handle workflow without nodes', () => {
			const workflowWithoutNodes = { ...mockWorkflowData, nodes: undefined };
			const contextWithoutNodes = { ...mockContext, workflowData: workflowWithoutNodes };
			const event = SegmentEventBuilder.buildWorkflowStartEvent(contextWithoutNodes);

			expect(event.metrics.node_count).toBe(0);
			expect(event.properties.trigger_node).toBeUndefined();
		});

		it('should handle workflow without tags', () => {
			const workflowWithoutTags = { ...mockWorkflowData, tags: undefined };
			const contextWithoutTags = { ...mockContext, workflowData: workflowWithoutTags };
			const event = SegmentEventBuilder.buildWorkflowStartEvent(contextWithoutTags);

			expect(event.tags).toEqual([]);
		});

		it('should handle workflow without version', () => {
			const workflowWithoutVersion = { ...mockWorkflowData, versionId: undefined };
			const contextWithoutVersion = { ...mockContext, workflowData: workflowWithoutVersion };
			const event = SegmentEventBuilder.buildWorkflowStartEvent(contextWithoutVersion);

			expect(event.properties.workflow_version).toBeUndefined();
		});

		it('should handle context without timing information', () => {
			const contextWithoutTiming = {
				...mockContext,
				startedAt: undefined,
				finishedAt: undefined,
			};
			const event = SegmentEventBuilder.buildWorkflowStartEvent(contextWithoutTiming);

			expect(event.properties.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
			expect(event.properties.finished_at).toBeUndefined();
		});

		it('should handle error without node information', () => {
			const error = {
				name: 'GenericError',
				message: 'Something went wrong',
			};

			const runData: IRun = {
				data: {
					resultData: { runData: {}, error },
					executionData: {
						contextData: {},
						nodeExecutionStack: [],
						metadata: {},
						waitingExecution: {},
						waitingExecutionSource: {},
					},
				},
				finished: true,
				mode: 'manual',
				status: 'error',
				startedAt: new Date(),
			};

			const contextWithError = { ...mockContext, runData };
			const event = SegmentEventBuilder.buildWorkflowErrorEvent(contextWithError);

			expect(event.properties.error_node_id).toBeUndefined();
			expect(event.properties.error_node_name).toBeUndefined();
		});
	});
});
