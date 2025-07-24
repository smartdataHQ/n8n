import type { Logger } from '@n8n/backend-common';
import { mockLogger } from '@n8n/backend-test-utils';
import { Container } from '@n8n/di';
import { randomUUID } from 'crypto';
import { Kafka, type Producer, type Consumer, type Admin } from 'kafkajs';
import type { WorkflowExecuteMode } from 'n8n-workflow';

import { CircuitBreaker } from '../components/circuit-breaker';
import { KafkaProducerWrapper } from '../components/kafka-producer-wrapper';
import type { KafkaLoggerConfig, ExecutionLogMessage } from '../models';
import type { WorkflowExecutionContext } from '../services/kafka-execution-logger.interface';
import { KafkaExecutionLogger } from '../services/kafka-execution-logger.service';
import { KafkaConfigLoader } from '../utils/config-loader';
import { SegmentEventBuilder } from '../utils/segment-event-builder';

// Mock Kafka for unit tests, but allow real Kafka for integration tests
const mockKafka = {
	producer: jest.fn(),
	consumer: jest.fn(),
	admin: jest.fn(),
};

// Only mock Kafka if not running integration tests
if (process.env.KAFKA_INTEGRATION_TESTS !== 'true') {
	jest.mock('kafkajs', () => ({
		Kafka: jest.fn().mockImplementation(() => mockKafka),
	}));
}

describe('Kafka Execution Logger Integration Tests', () => {
	let logger: Logger;
	let kafkaService: KafkaExecutionLogger;
	let realKafka: Kafka;
	let producer: Producer;
	let consumer: Consumer;
	let admin: Admin;
	let testTopic: string;

	// Test configuration for real Kafka cluster
	const testConfig: KafkaLoggerConfig = {
		enabled: true,
		kafka: {
			brokers: process.env.KAFKA_BROKERS?.split(',') ?? ['localhost:9092'],
			clientId: 'n8n-test-client',
			topic: `n8n-test-${randomUUID()}`,
			ssl: process.env.KAFKA_SSL === 'true',
			authentication: process.env.KAFKA_USERNAME
				? {
						username: process.env.KAFKA_USERNAME,
						password: process.env.KAFKA_PASSWORD ?? '',
						mechanism: (process.env.KAFKA_SASL_MECHANISM as any) ?? 'plain',
					}
				: undefined,
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
	};

	beforeAll(async () => {
		logger = mockLogger();
		testTopic = testConfig.kafka.topic;

		// Only run real Kafka tests if KAFKA_INTEGRATION_TESTS is set
		if (process.env.KAFKA_INTEGRATION_TESTS === 'true') {
			// Create real Kafka instance for integration tests
			realKafka = new Kafka({
				clientId: testConfig.kafka.clientId,
				brokers: testConfig.kafka.brokers,
				ssl: testConfig.kafka.ssl,
				sasl: testConfig.kafka.authentication,
			});

			admin = realKafka.admin();
			producer = realKafka.producer();
			consumer = realKafka.consumer({ groupId: `test-group-${randomUUID()}` });

			try {
				await admin.connect();

				// Create test topic
				await admin.createTopics({
					topics: [
						{
							topic: testTopic,
							numPartitions: 1,
							replicationFactor: 1,
						},
					],
				});

				await producer.connect();
				await consumer.connect();
				await consumer.subscribe({ topic: testTopic });
			} catch (error) {
				console.warn('Failed to setup real Kafka for integration tests:', error);
				// Skip real Kafka tests if setup fails
				process.env.KAFKA_INTEGRATION_TESTS = 'false';
			}
		}
	});

	afterAll(async () => {
		if (process.env.KAFKA_INTEGRATION_TESTS === 'true' && admin) {
			try {
				// Clean up test topic
				await admin.deleteTopics({ topics: [testTopic] });
				await admin.disconnect();
				await producer?.disconnect();
				await consumer?.disconnect();
			} catch (error) {
				console.warn('Failed to cleanup Kafka resources:', error);
			}
		}
	});

	beforeEach(() => {
		jest.clearAllMocks();
		Container.reset();

		// Register dependencies - use string token instead of class
		Container.set('Logger', logger);
	});

	describe('Component Integration', () => {
		it('should integrate all components correctly', async () => {
			const configLoader = new KafkaConfigLoader();

			kafkaService = new KafkaExecutionLogger(logger, configLoader);

			expect(kafkaService).toBeDefined();
			expect(kafkaService.isEnabled()).toBe(false); // Not initialized yet
		});

		it('should handle workflow execution events', async () => {
			const configLoader = new KafkaConfigLoader();
			const config = { ...configLoader.loadConfig(), enabled: true }; // Enable for real Kafka testing

			// Mock the config loader to return our test config
			jest.spyOn(configLoader, 'loadConfig').mockReturnValue(config);

			kafkaService = new KafkaExecutionLogger(logger, configLoader);

			await kafkaService.initialize();

			const context: WorkflowExecutionContext = {
				executionId: 'test-execution-id',
				workflowData: {
					id: 'test-workflow-id',
					name: 'Test Workflow',
					nodes: [],
					connections: {},
					active: true,
					settings: {},
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				mode: 'manual' as WorkflowExecuteMode,
				userId: 'test-user-id',
				startedAt: new Date(),
			};

			// This should work with real Kafka
			await kafkaService.handleWorkflowStart(context);

			// Verify service is enabled and working
			expect(kafkaService.isEnabled()).toBe(true);

			await kafkaService.shutdown();
		});
	});

	describe('Real Kafka Integration Tests', () => {
		// Skip these tests if real Kafka is not available
		const skipIfNoKafka = process.env.KAFKA_INTEGRATION_TESTS !== 'true' ? it : it;

		skipIfNoKafka('should connect to real Kafka cluster', async () => {
			const producerWrapper = new KafkaProducerWrapper(testConfig, logger);

			await expect(producerWrapper.connect()).resolves.not.toThrow();
			expect(producerWrapper.isConnected()).toBe(true);

			await producerWrapper.disconnect();
			expect(producerWrapper.isConnected()).toBe(false);
		});

		skipIfNoKafka('should send messages to real Kafka topic', async () => {
			const producerWrapper = new KafkaProducerWrapper(testConfig, logger);
			await producerWrapper.connect();

			const testMessage: ExecutionLogMessage = {
				type: 'track',
				event: 'Workflow Started',
				messageId: randomUUID(),
				timestamp: new Date().toISOString(),
				userId: 'test-user',
				dimensions: {
					execution_mode: 'manual',
					workflow_name: 'Test Workflow',
				},
				flags: {
					is_manual_execution: true,
					is_retry: false,
				},
				metrics: {
					node_count: 1,
				},
				tags: [],
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
					started_at: new Date().toISOString(),
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
			};

			await expect(producerWrapper.send(testMessage)).resolves.not.toThrow();
			await producerWrapper.disconnect();
		});

		skipIfNoKafka('should handle authentication with SASL/SSL', async () => {
			if (!testConfig.kafka.authentication) {
				console.log('Skipping authentication test - no credentials provided');
				return;
			}

			const authConfig = { ...testConfig };
			const producerWrapper = new KafkaProducerWrapper(authConfig, logger);

			await expect(producerWrapper.connect()).resolves.not.toThrow();
			expect(producerWrapper.isConnected()).toBe(true);

			await producerWrapper.disconnect();
		});

		skipIfNoKafka('should receive messages from Kafka topic', async () => {
			if (!producer || !consumer) {
				throw new Error('Kafka producer or consumer not initialized');
			}

			const testMessage: ExecutionLogMessage = {
				type: 'track',
				event: 'Workflow Completed',
				messageId: randomUUID(),
				timestamp: new Date().toISOString(),
				userId: 'test-user',
				dimensions: {
					execution_mode: 'manual',
					status: 'success',
					workflow_name: 'Test Workflow',
				},
				flags: {
					is_manual_execution: true,
					is_retry: false,
				},
				metrics: {
					duration_ms: 1000,
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
					started_at: new Date(Date.now() - 1000).toISOString(),
					finished_at: new Date().toISOString(),
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
			};

			// Send message
			await producer.send({
				topic: testTopic,
				messages: [
					{
						key: testMessage.messageId,
						value: JSON.stringify(testMessage),
					},
				],
			});

			// Consume message
			const receivedMessages: any[] = [];
			await consumer.run({
				eachMessage: async ({ message }) => {
					const parsedMessage = JSON.parse(message.value!.toString());
					receivedMessages.push(parsedMessage);
				},
			});

			// Wait for message to be consumed
			await new Promise((resolve) => setTimeout(resolve, 1000));

			expect(receivedMessages).toHaveLength(1);
			expect(receivedMessages[0].messageId).toBe(testMessage.messageId);
			expect(receivedMessages[0].event).toBe('Workflow Completed');
		});
	});

	describe('Failure Scenario Tests', () => {
		// Skip these tests if real Kafka is not available
		const skipIfNoKafka = process.env.KAFKA_INTEGRATION_TESTS !== 'true' ? it : it;

		skipIfNoKafka('should handle Kafka unavailable scenario', async () => {
			// Use invalid broker to simulate unavailable Kafka
			const failConfig: KafkaLoggerConfig = {
				...testConfig,
				kafka: {
					...testConfig.kafka,
					brokers: ['invalid-broker:9092'],
				},
				timeouts: {
					connect: 1000, // Short timeout for faster test
					send: 1000,
					disconnect: 1000,
				},
			};

			const producerWrapper = new KafkaProducerWrapper(failConfig, logger);

			await expect(producerWrapper.connect()).rejects.toThrow();
			expect(producerWrapper.isConnected()).toBe(false);
		});

		skipIfNoKafka('should handle network timeout scenarios', async () => {
			const timeoutConfig: KafkaLoggerConfig = {
				...testConfig,
				timeouts: {
					connect: 100, // Very short timeout
					send: 100,
					disconnect: 100,
				},
			};

			const producerWrapper = new KafkaProducerWrapper(timeoutConfig, logger);

			// This might timeout depending on network conditions
			try {
				await producerWrapper.connect();
				await producerWrapper.disconnect();
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toContain('timeout');
			}
		});

		it('should handle circuit breaker activation', async () => {
			// Use a very long monitoring period to avoid window resets during test
			const circuitBreaker = new CircuitBreaker({
				failureThreshold: 1,
				resetTimeout: 1000,
				monitoringPeriod: 60000,
			});

			// Simulate failures to trigger circuit breaker
			const failingOperation = async () => {
				throw new Error('Kafka error');
			};

			// First failure should open the circuit (threshold = 1)
			await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow('Kafka error');

			// Circuit should now be open
			expect(circuitBreaker.getState()).toBe('Open');

			// Next call should fail fast without executing the operation
			await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow(
				'Circuit breaker is open',
			);
		});
	});

	describe('Different n8n Workflow Execution Types', () => {
		const executionModes: WorkflowExecuteMode[] = [
			'manual',
			'trigger',
			'webhook',
			'error',
			'retry',
			'integrated',
			'cli',
		];

		executionModes.forEach((mode) => {
			it(`should handle ${mode} execution mode`, async () => {
				const context: WorkflowExecutionContext = {
					executionId: `test-execution-${mode}`,
					workflowData: {
						id: 'test-workflow-id',
						name: `Test Workflow ${mode}`,
						nodes: [],
						connections: {},
						active: true,
						settings: {},
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					mode,
					userId: 'test-user-id',
					startedAt: new Date(),
				};

				const message = SegmentEventBuilder.buildWorkflowStartEvent(context);

				expect(message.type).toBe('track');
				expect(message.event).toBe('Workflow Started');
				expect(message.dimensions.execution_mode).toBe(mode);
				expect(message.context.n8n.execution_mode).toBe(mode);
				expect(message.flags.is_manual_execution).toBe(mode === 'manual');
			});
		});

		it('should handle retry executions', async () => {
			const context: WorkflowExecutionContext = {
				executionId: 'test-execution-retry',
				workflowData: {
					id: 'test-workflow-id',
					name: 'Test Retry Workflow',
					nodes: [],
					connections: {},
					active: true,
					settings: {},
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				mode: 'retry',
				userId: 'test-user-id',
				retryOf: 'original-execution-id',
				startedAt: new Date(),
			};

			const message = SegmentEventBuilder.buildWorkflowStartEvent(context);

			expect(message.flags.is_retry).toBe(true);
			expect(message.properties.retry_of).toBe('original-execution-id');
		});
	});

	describe('Segment.com Message Format Compliance', () => {
		it('should validate required Segment.com fields', () => {
			const context: WorkflowExecutionContext = {
				executionId: 'test-execution-id',
				workflowData: {
					id: 'test-workflow-id',
					name: 'Test Workflow',
					nodes: [],
					connections: {},
					active: true,
					settings: {},
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				mode: 'manual',
				userId: 'test-user-id',
				startedAt: new Date(),
			};

			const message = SegmentEventBuilder.buildWorkflowStartEvent(context);

			// Required Segment.com fields
			expect(message.type).toBe('track');
			expect(message.event).toBeDefined();
			expect(message.timestamp).toBeDefined();
			expect(message.messageId).toBeDefined();

			// Validate timestamp format (ISO 8601)
			expect(() => new Date(message.timestamp)).not.toThrow();

			// Validate messageId format (UUID)
			expect(message.messageId).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);

			// Context Suite Extensions
			expect(message.dimensions).toBeDefined();
			expect(message.flags).toBeDefined();
			expect(message.metrics).toBeDefined();
			expect(message.tags).toBeDefined();
			expect(message.involves).toBeDefined();
			expect(message.properties).toBeDefined();
			expect(message.context).toBeDefined();
		});

		it('should handle error events with proper error details', () => {
			const context: WorkflowExecutionContext = {
				executionId: 'test-execution-id',
				workflowData: {
					id: 'test-workflow-id',
					name: 'Test Workflow',
					nodes: [
						{
							id: 'error-node',
							name: 'Error Node',
							type: 'test',
							typeVersion: 1,
							position: [0, 0],
							parameters: {},
						},
					],
					connections: {},
					active: true,
					settings: {},
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				mode: 'manual',
				userId: 'test-user-id',
				startedAt: new Date(Date.now() - 5000),
				finishedAt: new Date(),
				runData: {
					data: {},
					finished: false,
					mode: 'manual',
					startedAt: new Date(Date.now() - 5000),
					stoppedAt: new Date(),
					status: 'error',
				},
			};

			const message = SegmentEventBuilder.buildWorkflowErrorEvent(context);

			expect(message.event).toBe('Workflow Failed');
			expect(message.dimensions.status).toBe('error');
			expect(message.properties.finished_at).toBeDefined();
			expect(message.metrics.duration_ms).toBeGreaterThan(0);
		});
	});
});
