import type { Producer } from 'kafkajs';
import { Kafka } from 'kafkajs';

import type { ExecutionLogMessage, KafkaLoggerConfig } from '../models';
import { KafkaProducerWrapper } from '../components/kafka-producer-wrapper';

// Mock kafkajs
jest.mock('kafkajs');

const MockedKafka = Kafka as jest.MockedClass<typeof Kafka>;

describe('KafkaProducerWrapper', () => {
	let kafkaProducerWrapper: KafkaProducerWrapper;
	let mockProducer: jest.Mocked<Producer>;
	let mockKafka: jest.Mocked<Kafka>;
	let config: KafkaLoggerConfig;

	beforeEach(() => {
		// Reset all mocks
		jest.clearAllMocks();

		// Create mock producer
		mockProducer = {
			connect: jest.fn().mockResolvedValue(undefined),
			disconnect: jest.fn().mockResolvedValue(undefined),
			send: jest.fn().mockResolvedValue(undefined),
		} as any;

		// Create mock Kafka instance
		mockKafka = {
			producer: jest.fn().mockReturnValue(mockProducer),
		} as any;

		// Mock Kafka constructor
		MockedKafka.mockImplementation(() => mockKafka);

		// Create test configuration
		config = {
			enabled: true,
			kafka: {
				brokers: ['localhost:9092'],
				clientId: 'test-client',
				topic: 'test-topic',
				ssl: false,
				authentication: {
					username: 'test-user',
					password: 'test-pass',
					mechanism: 'plain',
				},
			},
			queue: {
				maxSize: 1000,
				batchSize: 100,
				flushInterval: 5000,
			},
			circuitBreaker: {
				failureThreshold: 5,
				resetTimeout: 60000,
				monitoringPeriod: 30000,
			},
			timeouts: {
				connect: 10000,
				send: 5000,
				disconnect: 5000,
			},
		};

		kafkaProducerWrapper = new KafkaProducerWrapper(config);
	});

	describe('connect', () => {
		it('should connect to Kafka successfully', async () => {
			mockProducer.connect.mockResolvedValue(undefined);

			await kafkaProducerWrapper.connect();

			expect(MockedKafka).toHaveBeenCalledWith({
				clientId: 'test-client',
				brokers: ['localhost:9092'],
				connectionTimeout: 10000,
				requestTimeout: 5000,
				ssl: false,
				sasl: {
					mechanism: 'plain',
					username: 'test-user',
					password: 'test-pass',
				},
			});
			expect(mockKafka.producer).toHaveBeenCalled();
			expect(mockProducer.connect).toHaveBeenCalled();
			expect(kafkaProducerWrapper.isConnected()).toBe(true);
		});

		it('should connect without authentication when not configured', async () => {
			const configWithoutAuth = { ...config };
			delete configWithoutAuth.kafka.authentication;
			kafkaProducerWrapper = new KafkaProducerWrapper(configWithoutAuth);

			mockProducer.connect.mockResolvedValue(undefined);

			await kafkaProducerWrapper.connect();

			expect(MockedKafka).toHaveBeenCalledWith({
				clientId: 'test-client',
				brokers: ['localhost:9092'],
				connectionTimeout: 10000,
				requestTimeout: 5000,
				ssl: false,
			});
		});

		it('should handle connection timeout', async () => {
			const shortTimeoutConfig = {
				...config,
				timeouts: { ...config.timeouts, connect: 100 },
			};
			kafkaProducerWrapper = new KafkaProducerWrapper(shortTimeoutConfig);

			// Mock a slow connection
			mockProducer.connect.mockImplementation(
				async () => await new Promise((resolve) => setTimeout(resolve, 200)),
			);

			await expect(kafkaProducerWrapper.connect()).rejects.toThrow(
				'Kafka producer connection timeout',
			);
			expect(kafkaProducerWrapper.isConnected()).toBe(false);
		});

		it('should handle connection errors', async () => {
			const error = new Error('Connection failed');
			mockProducer.connect.mockRejectedValue(error);

			await expect(kafkaProducerWrapper.connect()).rejects.toThrow(
				'Failed to connect to Kafka: Connection failed',
			);
			expect(kafkaProducerWrapper.isConnected()).toBe(false);
		});

		it('should not connect twice if already connected', async () => {
			mockProducer.connect.mockResolvedValue(undefined);

			await kafkaProducerWrapper.connect();
			await kafkaProducerWrapper.connect();

			expect(mockProducer.connect).toHaveBeenCalledTimes(1);
		});
	});

	describe('disconnect', () => {
		beforeEach(async () => {
			mockProducer.connect.mockResolvedValue(undefined);
			await kafkaProducerWrapper.connect();
		});

		it('should disconnect successfully', async () => {
			mockProducer.disconnect.mockResolvedValue(undefined);

			await kafkaProducerWrapper.disconnect();

			expect(mockProducer.disconnect).toHaveBeenCalled();
			expect(kafkaProducerWrapper.isConnected()).toBe(false);
		});

		it('should handle disconnect timeout', async () => {
			const shortTimeoutConfig = {
				...config,
				timeouts: { ...config.timeouts, disconnect: 100 },
			};
			kafkaProducerWrapper = new KafkaProducerWrapper(shortTimeoutConfig);
			await kafkaProducerWrapper.connect();

			// Mock a slow disconnect
			mockProducer.disconnect.mockImplementation(
				async () => await new Promise((resolve) => setTimeout(resolve, 200)),
			);

			// Should not throw, but should log error and clean up
			await kafkaProducerWrapper.disconnect();

			expect(kafkaProducerWrapper.isConnected()).toBe(false);
		});

		it('should handle disconnect errors gracefully', async () => {
			const error = new Error('Disconnect failed');
			mockProducer.disconnect.mockRejectedValue(error);

			// Should not throw, but should clean up
			await kafkaProducerWrapper.disconnect();

			expect(kafkaProducerWrapper.isConnected()).toBe(false);
		});

		it('should do nothing if not connected', async () => {
			await kafkaProducerWrapper.disconnect();
			mockProducer.disconnect.mockClear();

			await kafkaProducerWrapper.disconnect();

			expect(mockProducer.disconnect).not.toHaveBeenCalled();
		});
	});

	describe('send', () => {
		let testMessage: ExecutionLogMessage;

		beforeEach(async () => {
			mockProducer.connect.mockResolvedValue(undefined);
			await kafkaProducerWrapper.connect();

			testMessage = {
				type: 'track',
				event: 'Workflow Started',
				timestamp: '2023-01-01T00:00:00.000Z',
				messageId: 'test-message-id',
				dimensions: {
					execution_mode: 'manual',
					workflow_name: 'Test Workflow',
				},
				flags: {
					is_manual_execution: true,
					is_retry: false,
				},
				metrics: {
					node_count: 5,
				},
				tags: ['test'],
				involves: [
					{
						role: 'WorkflowExecution',
						id: 'exec-123',
						id_type: 'n8n',
					},
					{
						role: 'Workflow',
						id: 'workflow-456',
						id_type: 'n8n',
					},
				],
				properties: {
					started_at: '2023-01-01T00:00:00.000Z',
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
						id: 'instance-123',
						type: 'main',
					},
					n8n: {
						execution_mode: 'manual',
						instance_type: 'main',
					},
				},
			};
		});

		it('should send a message successfully', async () => {
			mockProducer.send.mockResolvedValue({} as any);

			await kafkaProducerWrapper.send(testMessage);

			expect(mockProducer.send).toHaveBeenCalledWith({
				topic: 'test-topic',
				messages: [
					{
						key: 'test-message-id',
						value: JSON.stringify(testMessage),
						timestamp: '1672531200000',
					},
				],
			});
		});

		it('should handle send timeout', async () => {
			const shortTimeoutConfig = {
				...config,
				timeouts: { ...config.timeouts, send: 100 },
			};
			kafkaProducerWrapper = new KafkaProducerWrapper(shortTimeoutConfig);
			await kafkaProducerWrapper.connect();

			// Mock a slow send
			mockProducer.send.mockImplementation(
				async () => await new Promise((resolve) => setTimeout(resolve, 200)),
			);

			await expect(kafkaProducerWrapper.send(testMessage)).rejects.toThrow(
				'Kafka message send timeout',
			);
		});

		it('should handle send errors', async () => {
			const error = new Error('Send failed');
			mockProducer.send.mockRejectedValue(error);

			await expect(kafkaProducerWrapper.send(testMessage)).rejects.toThrow(
				'Failed to send message to Kafka: Send failed',
			);
		});

		it('should throw error if not connected', async () => {
			await kafkaProducerWrapper.disconnect();

			await expect(kafkaProducerWrapper.send(testMessage)).rejects.toThrow(
				'Kafka producer is not connected',
			);
		});
	});

	describe('sendBatch', () => {
		let testMessages: ExecutionLogMessage[];

		beforeEach(async () => {
			mockProducer.connect.mockResolvedValue(undefined);
			await kafkaProducerWrapper.connect();

			testMessages = [
				{
					type: 'track',
					event: 'Workflow Started',
					timestamp: '2023-01-01T00:00:00.000Z',
					messageId: 'test-message-1',
					dimensions: {
						execution_mode: 'manual',
						workflow_name: 'Test Workflow 1',
					},
					flags: {
						is_manual_execution: true,
						is_retry: false,
					},
					metrics: {
						node_count: 3,
					},
					tags: ['test'],
					involves: [
						{
							role: 'WorkflowExecution',
							id: 'exec-123',
							id_type: 'n8n',
						},
						{
							role: 'Workflow',
							id: 'workflow-456',
							id_type: 'n8n',
						},
					],
					properties: {
						started_at: '2023-01-01T00:00:00.000Z',
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
							id: 'instance-123',
							type: 'main',
						},
						n8n: {
							execution_mode: 'manual',
							instance_type: 'main',
						},
					},
				},
				{
					type: 'track',
					event: 'Workflow Completed',
					timestamp: '2023-01-01T00:01:00.000Z',
					messageId: 'test-message-2',
					dimensions: {
						execution_mode: 'manual',
						workflow_name: 'Test Workflow 2',
						status: 'success',
					},
					flags: {
						is_manual_execution: true,
						is_retry: false,
					},
					metrics: {
						node_count: 5,
						duration_ms: 60000,
					},
					tags: ['test'],
					involves: [
						{
							role: 'WorkflowExecution',
							id: 'exec-124',
							id_type: 'n8n',
						},
						{
							role: 'Workflow',
							id: 'workflow-457',
							id_type: 'n8n',
						},
					],
					properties: {
						started_at: '2023-01-01T00:00:00.000Z',
						finished_at: '2023-01-01T00:01:00.000Z',
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
							id: 'instance-123',
							type: 'main',
						},
						n8n: {
							execution_mode: 'manual',
							instance_type: 'main',
						},
					},
				},
			];
		});

		it('should send batch messages successfully', async () => {
			mockProducer.send.mockResolvedValue({} as any);

			await kafkaProducerWrapper.sendBatch(testMessages);

			expect(mockProducer.send).toHaveBeenCalledWith({
				topic: 'test-topic',
				messages: [
					{
						key: 'test-message-1',
						value: JSON.stringify(testMessages[0]),
						timestamp: '1672531200000',
					},
					{
						key: 'test-message-2',
						value: JSON.stringify(testMessages[1]),
						timestamp: '1672531260000',
					},
				],
			});
		});

		it('should handle empty batch', async () => {
			await kafkaProducerWrapper.sendBatch([]);

			expect(mockProducer.send).not.toHaveBeenCalled();
		});

		it('should handle batch send timeout', async () => {
			const shortTimeoutConfig = {
				...config,
				timeouts: { ...config.timeouts, send: 100 },
			};
			kafkaProducerWrapper = new KafkaProducerWrapper(shortTimeoutConfig);
			await kafkaProducerWrapper.connect();

			// Mock a slow send
			mockProducer.send.mockImplementation(
				async () => await new Promise((resolve) => setTimeout(resolve, 200)),
			);

			await expect(kafkaProducerWrapper.sendBatch(testMessages)).rejects.toThrow(
				'Kafka batch send timeout',
			);
		});

		it('should handle batch send errors', async () => {
			const error = new Error('Batch send failed');
			mockProducer.send.mockRejectedValue(error);

			await expect(kafkaProducerWrapper.sendBatch(testMessages)).rejects.toThrow(
				'Failed to send batch messages to Kafka: Batch send failed',
			);
		});

		it('should throw error if not connected', async () => {
			await kafkaProducerWrapper.disconnect();

			await expect(kafkaProducerWrapper.sendBatch(testMessages)).rejects.toThrow(
				'Kafka producer is not connected',
			);
		});
	});

	describe('isConnected', () => {
		it('should return false initially', () => {
			expect(kafkaProducerWrapper.isConnected()).toBe(false);
		});

		it('should return true after successful connection', async () => {
			mockProducer.connect.mockResolvedValue(undefined);

			await kafkaProducerWrapper.connect();

			expect(kafkaProducerWrapper.isConnected()).toBe(true);
		});

		it('should return false after disconnection', async () => {
			mockProducer.connect.mockResolvedValue(undefined);
			mockProducer.disconnect.mockResolvedValue(undefined);

			await kafkaProducerWrapper.connect();
			await kafkaProducerWrapper.disconnect();

			expect(kafkaProducerWrapper.isConnected()).toBe(false);
		});

		it('should return false after connection failure', async () => {
			const error = new Error('Connection failed');
			mockProducer.connect.mockRejectedValue(error);

			try {
				await kafkaProducerWrapper.connect();
			} catch {
				// Expected to throw
			}

			expect(kafkaProducerWrapper.isConnected()).toBe(false);
		});
	});
});
