import type { Logger } from '@n8n/backend-common';
import { Container } from '@n8n/di';
import { mock } from 'jest-mock-extended';

import type { EventService } from '@/events/event.service';
import { KafkaExecutionLoggerIntegrationService } from '@/execution-lifecycle/kafka-execution-logger';

import type { KafkaExecutionLogger } from '../services/kafka-execution-logger.service';
import type { KafkaConfigLoader } from '../utils/config-loader';

describe('Service Lifecycle Integration', () => {
	let eventService: EventService;
	let integrationService: KafkaExecutionLoggerIntegrationService;
	let mockKafkaExecutionLogger: KafkaExecutionLogger;
	let mockConfigLoader: KafkaConfigLoader;

	beforeEach(() => {
		// Clear container
		Container.reset();

		// Create real EventService
		eventService = new EventService();

		// Create mocks
		mockKafkaExecutionLogger = mock<KafkaExecutionLogger>();
		mockConfigLoader = mock<KafkaConfigLoader>();

		// Setup default mock behavior
		mockConfigLoader.loadConfig.mockReturnValue({
			enabled: true,
			kafka: {
				brokers: ['localhost:9092'],
				clientId: 'n8n-execution-logger',
				topic: 'n8n-executions',
				ssl: false,
				authentication: undefined,
			},
			queue: {
				maxSize: 10000,
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
		});

		mockKafkaExecutionLogger.isEnabled.mockReturnValue(true);

		// Create integration service
		integrationService = new KafkaExecutionLoggerIntegrationService(
			mock<Logger>(),
			eventService,
			mockKafkaExecutionLogger,
			mockConfigLoader,
		);
	});

	afterEach(() => {
		jest.clearAllMocks();
		// Clean up environment variables
		delete process.env.N8N_KAFKA_LOGGER_ENABLED;
		delete process.env.N8N_KAFKA_LOGGER_BROKERS;
	});

	describe('service lifecycle integration with n8n startup', () => {
		it('should initialize when server-started event is emitted', async () => {
			// Setup environment for proper configuration
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			// Emit server-started event (simulating n8n startup)
			eventService.emit('server-started');

			// Wait for async event handler to complete
			await new Promise((resolve) => setImmediate(resolve));

			expect(mockKafkaExecutionLogger.initialize).toHaveBeenCalled();
			expect(integrationService.isEnabled()).toBe(true);
		});

		it('should handle configuration-based enable/disable', async () => {
			// Test disabled configuration
			mockConfigLoader.loadConfig.mockReturnValue({
				enabled: false,
				kafka: {
					brokers: ['localhost:9092'],
					clientId: 'n8n-execution-logger',
					topic: 'n8n-executions',
					ssl: false,
					authentication: undefined,
				},
				queue: {
					maxSize: 10000,
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
			});

			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			// Emit server-started event
			eventService.emit('server-started');

			// Wait for async event handler to complete
			await new Promise((resolve) => setImmediate(resolve));

			expect(mockKafkaExecutionLogger.initialize).not.toHaveBeenCalled();
			expect(integrationService.isEnabled()).toBe(false);
		});

		it('should shutdown properly during n8n shutdown', async () => {
			// Initialize first
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			eventService.emit('server-started');
			await new Promise((resolve) => setImmediate(resolve));

			// Now shutdown
			await integrationService.shutdown();

			expect(mockKafkaExecutionLogger.shutdown).toHaveBeenCalled();
		});
	});

	describe('service registration with dependency injection', () => {
		it('should be accessible via Container.get()', () => {
			// Register service with container
			Container.set(KafkaExecutionLoggerIntegrationService, integrationService);

			// Should be able to retrieve it
			const retrievedService = Container.get(KafkaExecutionLoggerIntegrationService);
			expect(retrievedService).toBe(integrationService);
		});

		it('should provide access to underlying KafkaExecutionLogger', () => {
			const kafkaLogger = integrationService.getKafkaExecutionLogger();
			expect(kafkaLogger).toBe(mockKafkaExecutionLogger);
		});
	});
});
