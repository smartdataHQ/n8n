import type { Logger } from '@n8n/backend-common';
import { mock } from 'jest-mock-extended';
import type { IWorkflowBase, WorkflowExecuteMode } from 'n8n-workflow';

import type { WorkflowExecutionContext } from '../services/kafka-execution-logger.interface';
import { KafkaExecutionLogger } from '../services/kafka-execution-logger.service';
import type { KafkaLoggerConfig, ExecutionLogMessage } from '../models';
import type {
	IMessageQueue,
	ICircuitBreaker,
	IKafkaProducerWrapper,
	IHealthMetrics,
	CircuitBreakerState,
} from '../components';
import type { KafkaConfigLoader } from '../utils';
import { SegmentEventBuilder } from '../utils';
import type { ErrorHandler } from '../utils/error-handler';
import { ErrorCategory } from '../utils/error-handler';

// Mock the components
jest.mock('../components/message-queue');
jest.mock('../components/circuit-breaker');
jest.mock('../components/kafka-producer-wrapper');
jest.mock('../components/health-metrics');
jest.mock('../utils/segment-event-builder');
jest.mock('../utils/error-handler');

describe('KafkaExecutionLogger', () => {
	let service: KafkaExecutionLogger;
	let mockLogger: Logger;
	let mockConfigLoader: KafkaConfigLoader;
	let mockMessageQueue: jest.Mocked<IMessageQueue>;
	let mockCircuitBreaker: jest.Mocked<ICircuitBreaker>;
	let mockKafkaProducer: jest.Mocked<IKafkaProducerWrapper>;
	let mockHealthMetrics: jest.Mocked<IHealthMetrics>;
	let mockErrorHandler: jest.Mocked<ErrorHandler>;
	let mockConfig: KafkaLoggerConfig;

	const createMockContext = (
		overrides: Partial<WorkflowExecutionContext> = {},
	): WorkflowExecutionContext => ({
		executionId: 'exec-123',
		workflowData: {
			id: 'workflow-456',
			name: 'Test Workflow',
			nodes: [],
			connections: {},
			active: true,
			settings: {},
		} as IWorkflowBase,
		mode: 'manual' as WorkflowExecuteMode,
		userId: 'user-789',
		startedAt: new Date('2023-01-01T10:00:00Z'),
		finishedAt: new Date('2023-01-01T10:01:00Z'),
		...overrides,
	});

	const createMockMessage = (event: ExecutionLogMessage['event']): ExecutionLogMessage => ({
		type: 'track',
		event,
		userId: 'user-789',
		timestamp: '2023-01-01T10:00:00.000Z',
		messageId: 'msg-123',
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
			started_at: '2023-01-01T10:00:00.000Z',
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
				execution_mode: 'manual' as WorkflowExecuteMode,
				instance_type: 'main',
			},
		},
	});

	beforeEach(() => {
		// Create mocks
		mockLogger = mock<Logger>();
		mockConfigLoader = mock<KafkaConfigLoader>();
		mockMessageQueue = mock<IMessageQueue>();
		mockCircuitBreaker = mock<ICircuitBreaker>();
		mockKafkaProducer = mock<IKafkaProducerWrapper>();
		mockHealthMetrics = mock<IHealthMetrics>();
		mockErrorHandler = mock<ErrorHandler>();

		// Mock configuration
		mockConfig = {
			enabled: true,
			kafka: {
				brokers: ['localhost:9092'],
				clientId: 'test-client',
				topic: 'test-topic',
				ssl: false,
			},
			queue: {
				maxSize: 1000,
				batchSize: 10,
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

		mockConfigLoader.loadConfig.mockReturnValue(mockConfig);

		// Mock component constructors
		const { MessageQueue } = require('../components/message-queue');
		const { CircuitBreaker } = require('../components/circuit-breaker');
		const { KafkaProducerWrapper } = require('../components/kafka-producer-wrapper');
		const { HealthMetrics } = require('../components/health-metrics');
		const { ErrorHandler } = require('../utils/error-handler');

		MessageQueue.mockImplementation(() => mockMessageQueue);
		CircuitBreaker.mockImplementation(() => mockCircuitBreaker);
		KafkaProducerWrapper.mockImplementation(() => mockKafkaProducer);
		HealthMetrics.mockImplementation(() => mockHealthMetrics);
		ErrorHandler.mockImplementation(() => mockErrorHandler);

		// Setup default mock behaviors
		mockCircuitBreaker.getState.mockReturnValue('Closed');
		mockCircuitBreaker.execute.mockImplementation(async (operation) => await operation());
		mockKafkaProducer.isConnected.mockReturnValue(true);
		mockMessageQueue.size.mockReturnValue(0);
		mockMessageQueue.enqueue.mockReturnValue(true);
		mockMessageQueue.dequeueBatch.mockReturnValue([]);
		mockErrorHandler.handleError.mockReturnValue({
			category: ErrorCategory.UNKNOWN,
			severity: 'MEDIUM' as any,
			message: 'Test error',
			originalError: new Error('Test'),
			shouldRetry: true,
			shouldFallback: true,
		});
		mockErrorHandler.categorizeError.mockReturnValue({
			category: ErrorCategory.UNKNOWN,
			severity: 'MEDIUM' as any,
			message: 'Test error',
			originalError: new Error('Test'),
			shouldRetry: true,
			shouldFallback: true,
		});

		// Create service instance
		service = new KafkaExecutionLogger(mockLogger, mockConfigLoader);
	});

	afterEach(() => {
		jest.clearAllMocks();
		jest.clearAllTimers();
	});

	describe('initialize', () => {
		it('should initialize successfully when enabled', async () => {
			await service.initialize();

			expect(mockConfigLoader.loadConfig).toHaveBeenCalled();
			expect(mockKafkaProducer.connect).toHaveBeenCalled();
			expect(service.isEnabled()).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith(
				'Kafka Execution Logger initialized successfully',
			);
		});

		it('should skip initialization when disabled', async () => {
			mockConfig.enabled = false;
			mockConfigLoader.loadConfig.mockReturnValue(mockConfig);

			await service.initialize();

			expect(mockKafkaProducer.connect).not.toHaveBeenCalled();
			expect(service.isEnabled()).toBe(false);
			expect(mockLogger.info).toHaveBeenCalledWith('Kafka Execution Logger is disabled');
		});

		it('should handle initialization errors gracefully', async () => {
			const error = new Error('Connection failed');
			mockKafkaProducer.connect.mockRejectedValue(error);

			// Should not throw - service continues with queuing when Kafka is unavailable
			await service.initialize();

			expect(service.isEnabled()).toBe(true);
			expect(mockLogger.warn).toHaveBeenCalledWith('Failed to connect to Kafka, will retry later', {
				error,
			});
		});

		it('should not reinitialize if already initialized', async () => {
			await service.initialize();
			mockKafkaProducer.connect.mockClear();

			await service.initialize();

			expect(mockKafkaProducer.connect).not.toHaveBeenCalled();
		});
	});

	describe('shutdown', () => {
		beforeEach(async () => {
			await service.initialize();
		});

		it('should shutdown gracefully', async () => {
			await service.shutdown();

			expect(mockKafkaProducer.disconnect).toHaveBeenCalled();
			expect(service.isEnabled()).toBe(false);
			expect(mockLogger.info).toHaveBeenCalledWith('Kafka Execution Logger shutdown completed');
		});

		it('should handle shutdown errors gracefully', async () => {
			const error = new Error('Disconnect failed');
			mockKafkaProducer.disconnect.mockRejectedValue(error);

			await service.shutdown();

			expect(mockLogger.error).toHaveBeenCalledWith(
				'Error during Kafka Execution Logger shutdown',
				{ error },
			);
		});

		it('should not shutdown if not initialized', async () => {
			const uninitializedService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);

			await uninitializedService.shutdown();

			expect(mockKafkaProducer.disconnect).not.toHaveBeenCalled();
		});
	});

	describe('handleWorkflowStart', () => {
		beforeEach(async () => {
			await service.initialize();
		});

		it('should process workflow start event', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Started');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);

			await service.handleWorkflowStart(context);

			expect(SegmentEventBuilder.buildWorkflowStartEvent).toHaveBeenCalledWith(context);
			expect(mockKafkaProducer.send).toHaveBeenCalledWith(mockMessage);
			expect(mockHealthMetrics.incrementSuccess).toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			const context = createMockContext();
			const error = new Error('Send failed');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(
				createMockMessage('Workflow Started'),
			);
			mockCircuitBreaker.execute.mockRejectedValue(error);

			await service.handleWorkflowStart(context);

			// Should not throw error - should queue message instead
			expect(mockMessageQueue.enqueue).toHaveBeenCalled();
			expect(mockHealthMetrics.incrementFailure).toHaveBeenCalled();
		});

		it('should skip processing when not initialized', async () => {
			const uninitializedService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);
			const context = createMockContext();

			await uninitializedService.handleWorkflowStart(context);

			expect(SegmentEventBuilder.buildWorkflowStartEvent).not.toHaveBeenCalled();
		});

		it('should skip processing when disabled', async () => {
			mockConfig.enabled = false;
			const disabledService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);
			await disabledService.initialize();

			const context = createMockContext();

			await disabledService.handleWorkflowStart(context);

			expect(SegmentEventBuilder.buildWorkflowStartEvent).not.toHaveBeenCalled();
		});
	});

	describe('handleWorkflowComplete', () => {
		beforeEach(async () => {
			await service.initialize();
		});

		it('should process workflow complete event', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Completed');

			(SegmentEventBuilder.buildWorkflowCompleteEvent as jest.Mock).mockReturnValue(mockMessage);

			await service.handleWorkflowComplete(context);

			expect(SegmentEventBuilder.buildWorkflowCompleteEvent).toHaveBeenCalledWith(context);
			expect(mockKafkaProducer.send).toHaveBeenCalledWith(mockMessage);
			expect(mockHealthMetrics.incrementSuccess).toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			const context = createMockContext();
			const error = new Error('Send failed');

			(SegmentEventBuilder.buildWorkflowCompleteEvent as jest.Mock).mockReturnValue(
				createMockMessage('Workflow Completed'),
			);
			mockCircuitBreaker.execute.mockRejectedValue(error);

			await service.handleWorkflowComplete(context);

			// Should not throw error - should queue message instead
			expect(mockMessageQueue.enqueue).toHaveBeenCalled();
			expect(mockHealthMetrics.incrementFailure).toHaveBeenCalled();
		});
	});

	describe('handleWorkflowError', () => {
		beforeEach(async () => {
			await service.initialize();
		});

		it('should process workflow error event', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Failed');

			(SegmentEventBuilder.buildWorkflowErrorEvent as jest.Mock).mockReturnValue(mockMessage);

			await service.handleWorkflowError(context);

			expect(SegmentEventBuilder.buildWorkflowErrorEvent).toHaveBeenCalledWith(context);
			expect(mockKafkaProducer.send).toHaveBeenCalledWith(mockMessage);
			expect(mockHealthMetrics.incrementSuccess).toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			const context = createMockContext();
			const error = new Error('Send failed');

			(SegmentEventBuilder.buildWorkflowErrorEvent as jest.Mock).mockReturnValue(
				createMockMessage('Workflow Failed'),
			);
			mockCircuitBreaker.execute.mockRejectedValue(error);

			await service.handleWorkflowError(context);

			// Should not throw error - should queue message instead
			expect(mockMessageQueue.enqueue).toHaveBeenCalled();
			expect(mockHealthMetrics.incrementFailure).toHaveBeenCalled();
		});
	});

	describe('message processing', () => {
		beforeEach(async () => {
			await service.initialize();
		});

		it('should send message immediately when circuit is closed and connected', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Started');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
			mockCircuitBreaker.getState.mockReturnValue('Closed');
			mockKafkaProducer.isConnected.mockReturnValue(true);
			mockMessageQueue.size.mockReturnValue(0);

			await service.handleWorkflowStart(context);

			expect(mockKafkaProducer.send).toHaveBeenCalledWith(mockMessage);
			expect(mockMessageQueue.enqueue).not.toHaveBeenCalled();
			expect(mockHealthMetrics.incrementSuccess).toHaveBeenCalled();
		});

		it('should queue message when circuit is open', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Started');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
			mockCircuitBreaker.getState.mockReturnValue('Open');

			await service.handleWorkflowStart(context);

			expect(mockKafkaProducer.send).not.toHaveBeenCalled();
			expect(mockMessageQueue.enqueue).toHaveBeenCalledWith(mockMessage);
		});

		it('should queue message when producer is not connected', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Started');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
			mockKafkaProducer.isConnected.mockReturnValue(false);

			await service.handleWorkflowStart(context);

			expect(mockKafkaProducer.send).not.toHaveBeenCalled();
			expect(mockMessageQueue.enqueue).toHaveBeenCalledWith(mockMessage);
		});

		it('should queue message when there are already queued messages', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Started');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
			mockMessageQueue.size.mockReturnValue(5); // Queue has messages

			await service.handleWorkflowStart(context);

			expect(mockKafkaProducer.send).not.toHaveBeenCalled();
			expect(mockMessageQueue.enqueue).toHaveBeenCalledWith(mockMessage);
		});

		it('should handle queue full scenario', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Started');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
			// Force queuing by making circuit open
			mockCircuitBreaker.getState.mockReturnValue('Open');
			mockMessageQueue.enqueue.mockReturnValue(false); // Queue is full

			await service.handleWorkflowStart(context);

			expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					operation: 'enqueue',
					executionId: context.executionId,
				}),
			);
			expect(mockErrorHandler.logToFallback).toHaveBeenCalledWith(
				mockMessage,
				'Queue overflow - message dropped',
			);
		});

		it('should fallback to queuing when immediate send fails', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Started');
			const error = new Error('Send failed');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
			mockCircuitBreaker.execute.mockRejectedValue(error);

			await service.handleWorkflowStart(context);

			expect(mockMessageQueue.enqueue).toHaveBeenCalledWith(mockMessage);
			expect(mockHealthMetrics.incrementFailure).toHaveBeenCalled();
		});
	});

	describe('background processing', () => {
		beforeEach(async () => {
			jest.useFakeTimers();
			await service.initialize();
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it('should flush queued messages periodically', async () => {
			const mockMessages = [createMockMessage('Workflow Started')];

			// Setup queue to have messages
			mockMessageQueue.size.mockReturnValue(1);
			mockMessageQueue.dequeueBatch.mockReturnValue(mockMessages);

			// Fast-forward time to trigger flush
			jest.advanceTimersByTime(mockConfig.queue.flushInterval);

			// Run pending timers and wait for async operations
			jest.runOnlyPendingTimers();
			await Promise.resolve();

			expect(mockMessageQueue.dequeueBatch).toHaveBeenCalledWith(mockConfig.queue.batchSize);
			expect(mockKafkaProducer.send).toHaveBeenCalledWith(mockMessages[0]);
		});

		it('should send batch when multiple messages are queued', async () => {
			const mockMessages = [
				createMockMessage('Workflow Started'),
				createMockMessage('Workflow Completed'),
			];

			// Setup queue to have messages
			mockMessageQueue.size.mockReturnValue(2);
			mockMessageQueue.dequeueBatch.mockReturnValue(mockMessages);

			jest.advanceTimersByTime(mockConfig.queue.flushInterval);
			jest.runOnlyPendingTimers();
			await Promise.resolve();

			expect(mockKafkaProducer.sendBatch).toHaveBeenCalledWith(mockMessages);
		});

		it('should skip flushing when circuit is open', async () => {
			mockCircuitBreaker.getState.mockReturnValue('Open');
			mockMessageQueue.dequeueBatch.mockReturnValue([createMockMessage('Workflow Started')]);

			jest.advanceTimersByTime(mockConfig.queue.flushInterval);
			jest.runOnlyPendingTimers();
			await Promise.resolve();

			expect(mockKafkaProducer.send).not.toHaveBeenCalled();
		});

		it('should reconnect when not connected during flush', async () => {
			mockKafkaProducer.isConnected.mockReturnValue(false);
			mockMessageQueue.dequeueBatch.mockReturnValue([createMockMessage('Workflow Started')]);

			jest.advanceTimersByTime(mockConfig.queue.flushInterval);
			jest.runOnlyPendingTimers();
			await Promise.resolve();

			expect(mockKafkaProducer.connect).toHaveBeenCalled();
		});

		it('should re-queue messages when send fails', async () => {
			const mockMessages = [createMockMessage('Workflow Started')];
			const error = new Error('Send failed');

			// Setup queue to have messages
			mockMessageQueue.size.mockReturnValue(1);
			mockMessageQueue.dequeueBatch.mockReturnValue(mockMessages);
			mockCircuitBreaker.execute.mockRejectedValue(error);

			jest.advanceTimersByTime(mockConfig.queue.flushInterval);
			jest.runOnlyPendingTimers();
			await Promise.resolve();

			expect(mockMessageQueue.enqueue).toHaveBeenCalledWith(mockMessages[0]);
			expect(mockHealthMetrics.incrementFailure).toHaveBeenCalled();
		});
	});

	describe('health metrics integration', () => {
		beforeEach(async () => {
			await service.initialize();
		});

		it('should update queue depth metrics', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Started');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
			mockMessageQueue.size.mockReturnValue(5);

			await service.handleWorkflowStart(context);

			expect(mockHealthMetrics.setQueueDepth).toHaveBeenCalledWith(5);
		});

		it('should update circuit breaker state metrics', async () => {
			const context = createMockContext();
			const mockMessage = createMockMessage('Workflow Started');

			(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
			mockCircuitBreaker.getState.mockReturnValue('Half-Open');

			await service.handleWorkflowStart(context);

			expect(mockHealthMetrics.setCircuitBreakerState).toHaveBeenCalledWith('Half-Open');
		});

		it('should expose health metrics', () => {
			const mockMetrics = {
				successCount: 10,
				failureCount: 2,
				queueDepth: 5,
				circuitBreakerState: 'Closed' as CircuitBreakerState,
				uptime: 60000,
			};

			mockHealthMetrics.getMetrics.mockReturnValue(mockMetrics);

			const metrics = service.getHealthMetrics();

			expect(metrics).toEqual(mockMetrics);
		});
	});

	describe('configuration', () => {
		it('should expose configuration', async () => {
			await service.initialize();

			const config = service.getConfig();

			expect(config).toEqual(mockConfig);
		});
	});

	describe('registerLifecycleHooks', () => {
		let mockHooks: any;

		beforeEach(async () => {
			await service.initialize();
			mockHooks = {
				executionId: 'exec-123',
				workflowData: {
					id: 'workflow-456',
					name: 'Test Workflow',
					nodes: [],
					connections: {},
					active: true,
					settings: {},
				} as IWorkflowBase,
				mode: 'manual',
				addHandler: jest.fn(),
			};
		});

		it('should register workflowExecuteBefore and workflowExecuteAfter hooks', () => {
			service.registerLifecycleHooks(mockHooks);

			expect(mockHooks.addHandler).toHaveBeenCalledTimes(2);
			expect(mockHooks.addHandler).toHaveBeenCalledWith(
				'workflowExecuteBefore',
				expect.any(Function),
			);
			expect(mockHooks.addHandler).toHaveBeenCalledWith(
				'workflowExecuteAfter',
				expect.any(Function),
			);
		});

		it('should not register hooks when service is not initialized', () => {
			const uninitializedService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);
			uninitializedService.registerLifecycleHooks(mockHooks);

			expect(mockHooks.addHandler).not.toHaveBeenCalled();
		});

		it('should not register hooks when service is disabled', async () => {
			mockConfig.enabled = false;
			const disabledService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);
			await disabledService.initialize();

			disabledService.registerLifecycleHooks(mockHooks);

			expect(mockHooks.addHandler).not.toHaveBeenCalled();
		});

		it('should handle workflowExecuteBefore hook execution', async () => {
			service.registerLifecycleHooks(mockHooks);

			// Get the registered handler
			const beforeHandler = mockHooks.addHandler.mock.calls.find(
				(call: any) => call[0] === 'workflowExecuteBefore',
			)[1];

			// Mock the hook context
			const hookContext = {
				executionId: 'exec-123',
				workflowData: {
					id: 'workflow-456',
					name: 'Test Workflow',
					nodes: [],
					connections: {},
					active: true,
					settings: {},
				} as IWorkflowBase,
				mode: 'manual',
				kafkaExecutionLogger: service,
			};

			// Execute the handler
			await beforeHandler.call(hookContext, {}, {});

			// Verify that handleWorkflowStart was called asynchronously
			// We need to wait for setImmediate to execute
			await new Promise((resolve) => setImmediate(resolve));

			expect(SegmentEventBuilder.buildWorkflowStartEvent).toHaveBeenCalled();
		});

		it('should handle workflowExecuteAfter hook execution for success', async () => {
			service.registerLifecycleHooks(mockHooks);

			// Get the registered handler
			const afterHandler = mockHooks.addHandler.mock.calls.find(
				(call: any) => call[0] === 'workflowExecuteAfter',
			)[1];

			// Mock the hook context
			const hookContext = {
				executionId: 'exec-123',
				workflowData: {
					id: 'workflow-456',
					name: 'Test Workflow',
					nodes: [],
					connections: {},
					active: true,
					settings: {},
				} as IWorkflowBase,
				mode: 'manual',
				kafkaExecutionLogger: service,
			};

			const successRunData = { status: 'success', startedAt: new Date(), finishedAt: new Date() };

			// Execute the handler
			await afterHandler.call(hookContext, successRunData, {});

			// Verify that handleWorkflowComplete was called asynchronously
			// We need to wait for setImmediate to execute
			await new Promise((resolve) => setImmediate(resolve));

			expect(SegmentEventBuilder.buildWorkflowCompleteEvent).toHaveBeenCalled();
		});

		it('should handle workflowExecuteAfter hook execution for error', async () => {
			service.registerLifecycleHooks(mockHooks);

			// Get the registered handler
			const afterHandler = mockHooks.addHandler.mock.calls.find(
				(call: any) => call[0] === 'workflowExecuteAfter',
			)[1];

			// Mock the hook context
			const hookContext = {
				executionId: 'exec-123',
				workflowData: {
					id: 'workflow-456',
					name: 'Test Workflow',
					nodes: [],
					connections: {},
					active: true,
					settings: {},
				} as IWorkflowBase,
				mode: 'manual',
				kafkaExecutionLogger: service,
			};

			const errorRunData = { status: 'error', startedAt: new Date(), finishedAt: new Date() };

			// Execute the handler
			await afterHandler.call(hookContext, errorRunData, {});

			// Verify that handleWorkflowError was called asynchronously
			// We need to wait for setImmediate to execute
			await new Promise((resolve) => setImmediate(resolve));

			expect(SegmentEventBuilder.buildWorkflowErrorEvent).toHaveBeenCalled();
		});

		it('should handle errors in hook handlers gracefully', async () => {
			service.registerLifecycleHooks(mockHooks);

			// Get the registered handler
			const beforeHandler = mockHooks.addHandler.mock.calls.find(
				(call: any) => call[0] === 'workflowExecuteBefore',
			)[1];

			// Mock the hook context without kafkaExecutionLogger
			const hookContext = {
				executionId: 'exec-123',
				workflowData: {
					id: 'workflow-456',
					name: 'Test Workflow',
					nodes: [],
					connections: {},
					active: true,
					settings: {},
				} as IWorkflowBase,
				mode: 'manual',
			};

			// Execute the handler - should not throw
			await expect(beforeHandler.call(hookContext, {}, {})).resolves.not.toThrow();
		});

		it('should store service reference in hooks context', () => {
			service.registerLifecycleHooks(mockHooks);

			expect(mockHooks.kafkaExecutionLogger).toBe(service);
		});
	});

	describe('error handling', () => {
		beforeEach(async () => {
			// Initialize service for error handling tests
			await service.initialize();
		});

		describe('initialization errors', () => {
			it('should handle configuration errors during initialization', async () => {
				const configError = new Error('Invalid configuration');
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.CONFIGURATION,
					severity: 'CRITICAL' as any,
					message: 'Configuration error',
					originalError: configError,
					shouldRetry: false,
					shouldFallback: false,
				});

				const uninitializedService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);
				mockKafkaProducer.connect.mockRejectedValue(configError);

				// Should not throw, but should disable the service
				await uninitializedService.initialize();

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					configError,
					expect.objectContaining({
						operation: 'connect',
					}),
				);
				expect(uninitializedService.isEnabled()).toBe(false);
			});

			it('should handle connection errors during initialization', async () => {
				const connectionError = new Error('Connection failed');
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.CONNECTION,
					severity: 'HIGH' as any,
					message: 'Connection error',
					originalError: connectionError,
					shouldRetry: true,
					shouldFallback: true,
				});

				const uninitializedService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);
				mockKafkaProducer.connect.mockRejectedValue(connectionError);

				await uninitializedService.initialize();

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					connectionError,
					expect.objectContaining({
						operation: 'connect',
					}),
				);
				expect(uninitializedService.isEnabled()).toBe(true); // Should remain enabled for retry
			});

			it('should handle authentication errors during initialization', async () => {
				const authError = new Error('Authentication failed');
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.AUTHENTICATION,
					severity: 'HIGH' as any,
					message: 'Authentication error',
					originalError: authError,
					shouldRetry: false,
					shouldFallback: true,
				});

				const uninitializedService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);
				mockKafkaProducer.connect.mockRejectedValue(authError);

				await uninitializedService.initialize();

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					authError,
					expect.objectContaining({
						operation: 'connect',
					}),
				);
				expect(uninitializedService.isEnabled()).toBe(false); // Should be disabled
			});
		});

		describe('workflow event handling errors', () => {
			it('should handle serialization errors in workflow start events', async () => {
				const context = createMockContext();
				const serializationError = new Error('JSON serialization failed');

				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.SERIALIZATION,
					severity: 'MEDIUM' as any,
					message: 'Serialization error',
					originalError: serializationError,
					shouldRetry: false,
					shouldFallback: false,
				});

				(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockImplementation(() => {
					throw serializationError;
				});

				await service.handleWorkflowStart(context);

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					serializationError,
					expect.objectContaining({
						operation: 'handleWorkflowStart',
						executionId: context.executionId,
					}),
				);
				expect(mockErrorHandler.logToFallback).not.toHaveBeenCalled(); // Should not fallback for serialization errors
			});

			it('should use fallback logging for retryable errors in workflow events', async () => {
				const context = createMockContext();
				const connectionError = new Error('Connection failed');
				const mockMessage = createMockMessage('Workflow Started');

				// Mock the error to be handled at processMessage level with non-retryable but fallback-enabled error
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.CONNECTION,
					severity: 'HIGH' as any,
					message: 'Connection error',
					originalError: connectionError,
					shouldRetry: false, // Non-retryable so it goes to fallback
					shouldFallback: true,
				});

				// Mock processMessage to throw an error
				(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
				mockCircuitBreaker.execute.mockRejectedValue(connectionError);

				await service.handleWorkflowStart(context);

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					connectionError,
					expect.objectContaining({
						operation: 'sendImmediate',
					}),
				);
				expect(mockErrorHandler.logToFallback).toHaveBeenCalledWith(
					mockMessage,
					'Immediate send failed: CONNECTION',
				);
			});

			it('should handle fallback logging failures gracefully', async () => {
				const context = createMockContext();
				const connectionError = new Error('Connection failed');
				const fallbackError = new Error('Fallback failed');
				const mockMessage = createMockMessage('Workflow Started');

				// Mock buildWorkflowStartEvent to throw an error to trigger the catch block
				(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock)
					.mockImplementationOnce(() => {
						throw connectionError;
					})
					.mockReturnValueOnce(mockMessage);

				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.CONNECTION,
					severity: 'HIGH' as any,
					message: 'Connection error',
					originalError: connectionError,
					shouldRetry: true,
					shouldFallback: true,
				});

				mockErrorHandler.logToFallback.mockImplementation(() => {
					throw fallbackError;
				});

				// Should not throw even if fallback fails
				await expect(service.handleWorkflowStart(context)).resolves.not.toThrow();

				expect(mockLogger.error).toHaveBeenCalledWith(
					'Fallback logging failed for workflow start event',
					expect.objectContaining({
						executionId: context.executionId,
						fallbackError,
					}),
				);
			});
		});

		describe('message processing errors', () => {
			it('should handle immediate send failures with fallback', async () => {
				const context = createMockContext();
				const mockMessage = createMockMessage('Workflow Started');
				const sendError = new Error('Send failed');

				(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
				mockCircuitBreaker.execute.mockRejectedValue(sendError);
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.MESSAGE_SENDING,
					severity: 'MEDIUM' as any,
					message: 'Send error',
					originalError: sendError,
					shouldRetry: false,
					shouldFallback: true,
				});

				await service.handleWorkflowStart(context);

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					sendError,
					expect.objectContaining({
						operation: 'sendImmediate',
					}),
				);
				expect(mockErrorHandler.logToFallback).toHaveBeenCalledWith(
					mockMessage,
					'Immediate send failed: MESSAGE_SENDING',
				);
			});

			it('should handle queue overflow with fallback logging', async () => {
				const context = createMockContext();
				const mockMessage = createMockMessage('Workflow Started');

				(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockReturnValue(mockMessage);
				mockCircuitBreaker.getState.mockReturnValue('Open'); // Force queuing
				mockMessageQueue.enqueue.mockReturnValue(false); // Queue is full

				await service.handleWorkflowStart(context);

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					expect.any(Error),
					expect.objectContaining({
						operation: 'enqueue',
						executionId: context.executionId,
					}),
				);
				expect(mockErrorHandler.logToFallback).toHaveBeenCalledWith(
					mockMessage,
					'Queue overflow - message dropped',
				);
			});
		});

		describe('batch processing errors', () => {
			beforeEach(() => {
				jest.useFakeTimers();
			});

			afterEach(() => {
				jest.useRealTimers();
			});

			it('should handle batch send failures with retry', async () => {
				const mockMessages = [createMockMessage('Workflow Started')];
				const batchError = new Error('Batch send failed');

				// Setup queue to have messages initially, then empty after dequeue
				mockMessageQueue.size.mockReturnValueOnce(1).mockReturnValue(0);
				mockMessageQueue.dequeueBatch.mockReturnValue(mockMessages);
				mockCircuitBreaker.execute.mockRejectedValue(batchError);
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.MESSAGE_SENDING,
					severity: 'MEDIUM' as any,
					message: 'Batch send error',
					originalError: batchError,
					shouldRetry: true,
					shouldFallback: true,
				});

				// Manually trigger the flush
				await (service as any).triggerFlush();

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					batchError,
					expect.objectContaining({
						operation: 'flushBatch',
						messageCount: 1,
					}),
				);
				expect(mockMessageQueue.enqueue).toHaveBeenCalledWith(mockMessages[0]); // Should re-queue
			});

			it('should use fallback logging for non-retryable batch errors', async () => {
				const mockMessages = [createMockMessage('Workflow Started')];
				const authError = new Error('Authentication failed');

				// Setup queue to have messages initially, then empty after dequeue
				mockMessageQueue.size.mockReturnValueOnce(1).mockReturnValue(0);
				mockMessageQueue.dequeueBatch.mockReturnValue(mockMessages);
				mockCircuitBreaker.execute.mockRejectedValue(authError);
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.AUTHENTICATION,
					severity: 'HIGH' as any,
					message: 'Auth error',
					originalError: authError,
					shouldRetry: false,
					shouldFallback: true,
				});

				// Manually trigger the flush
				await (service as any).triggerFlush();

				expect(mockErrorHandler.logBatchToFallback).toHaveBeenCalledWith(
					mockMessages,
					'Send failed: AUTHENTICATION',
				);
				expect(mockMessageQueue.enqueue).not.toHaveBeenCalled(); // Should not re-queue
			});

			it('should disable service on critical batch errors', async () => {
				const mockMessages = [createMockMessage('Workflow Started')];
				const configError = new Error('Configuration error');

				// Setup queue to have messages initially, then empty after dequeue
				mockMessageQueue.size.mockReturnValueOnce(1).mockReturnValue(0);
				mockMessageQueue.dequeueBatch.mockReturnValue(mockMessages);
				mockCircuitBreaker.execute.mockRejectedValue(configError);
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.CONFIGURATION,
					severity: 'CRITICAL' as any,
					message: 'Config error',
					originalError: configError,
					shouldRetry: false,
					shouldFallback: true,
				});

				// Manually trigger the flush
				await (service as any).triggerFlush();

				expect(service.isEnabled()).toBe(false);
				expect(mockLogger.error).toHaveBeenCalledWith(
					'Critical error during batch send - disabling Kafka logging',
					expect.objectContaining({ error: configError }),
				);
			});
		});

		describe('reconnection errors', () => {
			beforeEach(() => {
				jest.useFakeTimers();
			});

			afterEach(() => {
				jest.useRealTimers();
			});

			it('should handle reconnection failures during flush', async () => {
				const reconnectError = new Error('Reconnection failed');

				// Setup queue to have messages to trigger flush
				mockMessageQueue.size.mockReturnValueOnce(1).mockReturnValue(0);
				mockMessageQueue.dequeueBatch.mockReturnValue([]);
				mockKafkaProducer.isConnected.mockReturnValue(false);
				mockCircuitBreaker.execute.mockRejectedValue(reconnectError);
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.CONNECTION,
					severity: 'HIGH' as unknown,
					message: 'Reconnect error',
					originalError: reconnectError,
					shouldRetry: true,
					shouldFallback: true,
				});

				// Manually trigger the flush
				await (service as any).triggerFlush();

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					reconnectError,
					expect.objectContaining({
						operation: 'reconnect',
					}),
				);
			});

			it('should disable service on critical reconnection errors', async () => {
				const authError = new Error('Authentication failed');

				// Setup queue to have messages to trigger flush
				mockMessageQueue.size.mockReturnValueOnce(1).mockReturnValue(0);
				mockMessageQueue.dequeueBatch.mockReturnValue([]);
				mockKafkaProducer.isConnected.mockReturnValue(false);
				mockCircuitBreaker.execute.mockRejectedValue(authError);
				mockErrorHandler.handleError.mockReturnValue({
					category: ErrorCategory.AUTHENTICATION,
					severity: 'HIGH' as unknown,
					message: 'Auth error',
					originalError: authError,
					shouldRetry: false,
					shouldFallback: true,
				});

				// Manually trigger the flush
				await (service as any).triggerFlush();

				expect(service.isEnabled()).toBe(false);
				expect(mockLogger.error).toHaveBeenCalledWith(
					'Critical error during reconnection - disabling Kafka logging',
					expect.objectContaining({ error: authError }),
				);
			});
		});

		describe('graceful degradation', () => {
			it('should continue workflow execution even when logging fails', async () => {
				const context = createMockContext();
				const criticalError = new Error('Critical logging failure');

				(SegmentEventBuilder.buildWorkflowStartEvent as jest.Mock).mockImplementation(() => {
					throw criticalError;
				});

				// Should not throw - workflow execution must continue
				await expect(service.handleWorkflowStart(context)).resolves.not.toThrow();

				expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
					criticalError,
					expect.any(Object),
				);
			});

			it('should skip processing when service is disabled', async () => {
				const context = createMockContext();

				// Disable the service
				mockConfig.enabled = false;
				const disabledService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);
				await disabledService.initialize();

				await disabledService.handleWorkflowStart(context);

				expect(SegmentEventBuilder.buildWorkflowStartEvent).not.toHaveBeenCalled();
				expect(mockErrorHandler.handleError).not.toHaveBeenCalled();
			});

			it('should skip processing when service is not initialized', async () => {
				const context = createMockContext();
				const uninitializedService = new KafkaExecutionLogger(mockLogger, mockConfigLoader);

				await uninitializedService.handleWorkflowStart(context);

				expect(SegmentEventBuilder.buildWorkflowStartEvent).not.toHaveBeenCalled();
				expect(mockErrorHandler.handleError).not.toHaveBeenCalled();
			});
		});
	});
});
