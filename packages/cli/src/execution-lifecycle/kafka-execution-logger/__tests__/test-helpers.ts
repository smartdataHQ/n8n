import { randomUUID } from 'crypto';
import type { WorkflowExecuteMode } from 'n8n-workflow';

import type { ExecutionLogMessage, KafkaLoggerConfig } from '../models';
import type { WorkflowExecutionContext } from '../services/kafka-execution-logger.interface';

/**
 * Test helper utilities for Kafka integration tests
 */

/**
 * Create a test workflow execution context
 */
export function createTestExecutionContext(
	overrides: Partial<WorkflowExecutionContext> = {},
): WorkflowExecutionContext {
	return {
		executionId: randomUUID(),
		workflowData: {
			id: randomUUID(),
			name: 'Test Workflow',
			nodes: [
				{
					id: 'test-node-1',
					name: 'Test Node 1',
					type: 'n8n-nodes-base.start',
					typeVersion: 1,
					position: [100, 200],
					parameters: {},
				},
				{
					id: 'test-node-2',
					name: 'Test Node 2',
					type: 'n8n-nodes-base.set',
					typeVersion: 1,
					position: [300, 200],
					parameters: {},
				},
			],
			connections: {
				'test-node-1': {
					main: [
						[
							{
								node: 'test-node-2',
								type: 'main',
								index: 0,
							},
						],
					],
				},
			},
			active: true,
			settings: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		mode: 'manual' as WorkflowExecuteMode,
		userId: 'test-user-id',
		startedAt: new Date(),
		...overrides,
	};
}

/**
 * Create a test Kafka configuration
 */
export function createTestKafkaConfig(
	overrides: Partial<KafkaLoggerConfig> = {},
): KafkaLoggerConfig {
	return {
		enabled: true,
		kafka: {
			brokers: ['localhost:9092'],
			clientId: 'n8n-test-client',
			topic: `n8n-test-${randomUUID()}`,
			ssl: false,
			authentication: undefined,
		},
		queue: {
			maxSize: 1000,
			batchSize: 10,
			flushInterval: 1000,
		},
		circuitBreaker: {
			failureThreshold: 3,
			resetTimeout: 5000,
			monitoringPeriod: 10000,
		},
		timeouts: {
			connect: 10000,
			send: 5000,
			disconnect: 5000,
		},
		...overrides,
	};
}

/**
 * Create a test execution log message
 */
export function createTestExecutionMessage(
	overrides: Partial<ExecutionLogMessage> = {},
): ExecutionLogMessage {
	const messageId = randomUUID();
	const timestamp = new Date().toISOString();

	return {
		type: 'track',
		event: 'Workflow Started',
		messageId,
		timestamp,
		userId: 'test-user-id',
		dimensions: {
			execution_mode: 'manual',
			workflow_name: 'Test Workflow',
		},
		flags: {
			is_manual_execution: true,
			is_retry: false,
		},
		metrics: {
			node_count: 2,
		},
		tags: ['test'],
		involves: [
			{
				role: 'WorkflowExecution',
				id: 'test-execution-id',
				id_type: 'n8n',
			},
			{
				role: 'Workflow',
				id: 'test-workflow-id',
				id_type: 'n8n',
			},
		],
		properties: {
			started_at: timestamp,
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
				id: 'test-instance',
				type: 'main',
			},
			n8n: {
				execution_mode: 'manual' as WorkflowExecuteMode,
				instance_type: 'main',
			},
		},
		...overrides,
	};
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitForCondition(
	condition: () => boolean | Promise<boolean>,
	timeoutMs: number = 5000,
	intervalMs: number = 100,
): Promise<void> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}

	throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Validate Segment.com track event format
 */
export function validateSegmentTrackEvent(message: ExecutionLogMessage): void {
	// Required Segment.com fields
	expect(message.type).toBe('track');
	expect(message.event).toBeDefined();
	expect(typeof message.event).toBe('string');
	expect(message.timestamp).toBeDefined();
	expect(message.messageId).toBeDefined();

	// Validate timestamp format (ISO 8601)
	expect(() => new Date(message.timestamp)).not.toThrow();
	expect(new Date(message.timestamp).toISOString()).toBe(message.timestamp);

	// Validate messageId format (UUID)
	expect(message.messageId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	);

	// Context Suite Extensions
	expect(message.dimensions).toBeDefined();
	expect(typeof message.dimensions).toBe('object');
	expect(message.flags).toBeDefined();
	expect(typeof message.flags).toBe('object');
	expect(message.metrics).toBeDefined();
	expect(typeof message.metrics).toBe('object');
	expect(Array.isArray(message.tags)).toBe(true);
	expect(Array.isArray(message.involves)).toBe(true);
	expect(message.properties).toBeDefined();
	expect(typeof message.properties).toBe('object');
	expect(message.context).toBeDefined();
	expect(typeof message.context).toBe('object');

	// Validate involves structure
	expect(message.involves).toHaveLength(2);
	expect(message.involves[0].role).toBe('WorkflowExecution');
	expect(message.involves[0].id_type).toBe('n8n');
	expect(message.involves[1].role).toBe('Workflow');
	expect(message.involves[1].id_type).toBe('n8n');

	// Validate context structure
	expect(message.context.app.name).toBe('n8n');
	expect(message.context.library.name).toBe('n8n-kafka-execution-logger');
	expect(message.context.instance.type).toMatch(/^(main|worker)$/);
	expect(message.context.n8n.instance_type).toMatch(/^(main|worker)$/);
}

/**
 * Create test configurations for different authentication mechanisms
 */
export const testConfigurations = {
	plaintext: (topic: string): KafkaLoggerConfig =>
		createTestKafkaConfig({
			kafka: {
				brokers: ['localhost:9092'],
				clientId: 'n8n-test-plaintext',
				topic,
				ssl: false,
			},
		}),

	saslPlain: (topic: string): KafkaLoggerConfig =>
		createTestKafkaConfig({
			kafka: {
				brokers: ['localhost:9093'],
				clientId: 'n8n-test-sasl-plain',
				topic,
				ssl: false,
				authentication: {
					username: 'testuser',
					password: 'testuser-secret',
					mechanism: 'plain',
				},
			},
		}),

	saslScram256: (topic: string): KafkaLoggerConfig =>
		createTestKafkaConfig({
			kafka: {
				brokers: ['localhost:9093'],
				clientId: 'n8n-test-sasl-scram256',
				topic,
				ssl: false,
				authentication: {
					username: 'admin',
					password: 'admin-secret',
					mechanism: 'scram-sha-256',
				},
			},
		}),

	ssl: (topic: string): KafkaLoggerConfig =>
		createTestKafkaConfig({
			kafka: {
				brokers: ['localhost:9094'],
				clientId: 'n8n-test-ssl',
				topic,
				ssl: true,
			},
		}),
};

/**
 * Mock Kafka producer for unit tests
 */
export function createMockKafkaProducer() {
	return {
		connect: jest.fn().mockResolvedValue(undefined),
		disconnect: jest.fn().mockResolvedValue(undefined),
		send: jest.fn().mockResolvedValue(undefined),
		sendBatch: jest.fn().mockResolvedValue(undefined),
		isConnected: jest.fn().mockReturnValue(true),
	};
}

/**
 * Error simulation helpers
 */
export const errorSimulators = {
	connectionError: () => {
		const error = new Error('Connection refused');
		error.name = 'KafkaConnectionError';
		return error;
	},

	authenticationError: () => {
		const error = new Error('Authentication failed');
		error.name = 'KafkaAuthenticationError';
		return error;
	},

	timeoutError: () => {
		const error = new Error('Operation timed out');
		error.name = 'KafkaTimeoutError';
		return error;
	},

	topicError: () => {
		const error = new Error('Topic does not exist');
		error.name = 'KafkaTopicError';
		return error;
	},

	serializationError: () => {
		const error = new Error('Invalid message format');
		error.name = 'KafkaSerializationError';
		return error;
	},
};
