import type { Logger } from '@n8n/backend-common';
import { mock } from 'jest-mock-extended';

import type { EventService } from '@/events/event.service';
import { KafkaExecutionLoggerIntegrationService } from '@/execution-lifecycle/kafka-execution-logger';

import type { KafkaLoggerConfig } from '../models';
import type { KafkaExecutionLogger } from '../services/kafka-execution-logger.service';
import type { KafkaConfigLoader } from '../utils/config-loader';

describe('KafkaExecutionLoggerIntegrationService', () => {
	let service: KafkaExecutionLoggerIntegrationService;
	let mockLogger: Logger;
	let mockEventService: EventService;
	let mockKafkaExecutionLogger: KafkaExecutionLogger;
	let mockConfigLoader: KafkaConfigLoader;

	const defaultConfig: KafkaLoggerConfig = {
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
	};

	beforeEach(() => {
		// Create mocks
		mockLogger = mock<Logger>();
		mockEventService = mock<EventService>();
		mockKafkaExecutionLogger = mock<KafkaExecutionLogger>();
		mockConfigLoader = mock<KafkaConfigLoader>();

		// Setup default mock behavior
		mockConfigLoader.loadConfig.mockReturnValue(defaultConfig);
		mockKafkaExecutionLogger.isEnabled.mockReturnValue(true);

		// Create service instance
		service = new KafkaExecutionLoggerIntegrationService(
			mockLogger,
			mockEventService,
			mockKafkaExecutionLogger,
			mockConfigLoader,
		);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('constructor', () => {
		it('should set up event listeners for server-started', () => {
			expect(mockEventService.on).toHaveBeenCalledWith('server-started', expect.any(Function));
		});
	});

	describe('server-started event handling', () => {
		let serverStartedHandler: () => Promise<void>;

		beforeEach(() => {
			// Extract the server-started handler from the mock call
			const onCall = mockEventService.on.mock.calls.find((call) => call[0] === 'server-started');
			serverStartedHandler = onCall?.[1] as () => Promise<void>;
		});

		it('should initialize service when Kafka is properly configured', async () => {
			// Setup environment variables to simulate proper configuration
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			await serverStartedHandler();

			expect(mockKafkaExecutionLogger.initialize).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				'Kafka Execution Logger integration service initialized successfully',
			);
		});

		it('should warn when Kafka is not configured', async () => {
			// Clear environment variables
			delete process.env.N8N_KAFKA_LOGGER_ENABLED;
			delete process.env.N8N_KAFKA_LOGGER_BROKERS;

			await serverStartedHandler();

			expect(mockKafkaExecutionLogger.initialize).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'Kafka Execution Logger is not configured. Set N8N_KAFKA_LOGGER_ENABLED=true and configure Kafka brokers to enable execution logging.',
				{
					requiredEnvVars: [
						'N8N_KAFKA_LOGGER_ENABLED=true',
						'N8N_KAFKA_LOGGER_BROKERS=localhost:9092',
					],
				},
			);
		});

		it('should not initialize when service is disabled via configuration', async () => {
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			// Mock config to return disabled
			mockConfigLoader.loadConfig.mockReturnValue({
				...defaultConfig,
				enabled: false,
			});

			await serverStartedHandler();

			expect(mockKafkaExecutionLogger.initialize).not.toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				'Kafka Execution Logger is disabled via configuration',
			);
		});

		it('should handle initialization errors gracefully', async () => {
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			const error = new Error('Initialization failed');
			mockKafkaExecutionLogger.initialize.mockRejectedValue(error);

			await serverStartedHandler();

			expect(mockLogger.error).toHaveBeenCalledWith(
				'Failed to initialize Kafka Execution Logger integration service',
				{ error },
			);
		});

		it('should not initialize twice', async () => {
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			// Call twice
			await serverStartedHandler();
			await serverStartedHandler();

			// Should only initialize once
			expect(mockKafkaExecutionLogger.initialize).toHaveBeenCalledTimes(1);
		});
	});

	describe('isKafkaConfigured', () => {
		it('should return true when explicitly enabled with custom brokers', () => {
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'custom-broker:9092';

			// Access private method via type assertion for testing
			const isConfigured = (service as any).isKafkaConfigured(defaultConfig);
			expect(isConfigured).toBe(true);
		});

		it('should return true when explicitly enabled with default brokers', () => {
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			delete process.env.N8N_KAFKA_LOGGER_BROKERS;

			const isConfigured = (service as any).isKafkaConfigured(defaultConfig);
			expect(isConfigured).toBe(true);
		});

		it('should return false when not explicitly enabled', () => {
			delete process.env.N8N_KAFKA_LOGGER_ENABLED;
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'custom-broker:9092';

			const isConfigured = (service as any).isKafkaConfigured(defaultConfig);
			expect(isConfigured).toBe(false);
		});

		it('should return false when enabled is not "true"', () => {
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'false';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'custom-broker:9092';

			const isConfigured = (service as any).isKafkaConfigured(defaultConfig);
			expect(isConfigured).toBe(false);
		});
	});

	describe('shutdown', () => {
		it('should shutdown the Kafka execution logger when initialized', async () => {
			// Initialize first
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			const serverStartedHandler = mockEventService.on.mock.calls.find(
				(call) => call[0] === 'server-started',
			)?.[1] as () => Promise<void>;
			await serverStartedHandler();

			// Now shutdown
			await service.shutdown();

			expect(mockKafkaExecutionLogger.shutdown).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				'Shutting down Kafka Execution Logger integration service...',
			);
			expect(mockLogger.info).toHaveBeenCalledWith(
				'Kafka Execution Logger integration service shutdown completed',
			);
		});

		it('should not shutdown when not initialized', async () => {
			await service.shutdown();

			expect(mockKafkaExecutionLogger.shutdown).not.toHaveBeenCalled();
		});

		it('should handle shutdown errors gracefully', async () => {
			// Initialize first
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			const serverStartedHandler = mockEventService.on.mock.calls.find(
				(call) => call[0] === 'server-started',
			)?.[1] as () => Promise<void>;
			await serverStartedHandler();

			// Mock shutdown error
			const error = new Error('Shutdown failed');
			mockKafkaExecutionLogger.shutdown.mockRejectedValue(error);

			await service.shutdown();

			expect(mockLogger.error).toHaveBeenCalledWith(
				'Error during Kafka Execution Logger integration service shutdown',
				{ error },
			);
		});
	});

	describe('isEnabled', () => {
		it('should return true when initialized and underlying service is enabled', async () => {
			// Initialize first
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			const serverStartedHandler = mockEventService.on.mock.calls.find(
				(call) => call[0] === 'server-started',
			)?.[1] as () => Promise<void>;
			await serverStartedHandler();

			mockKafkaExecutionLogger.isEnabled.mockReturnValue(true);

			expect(service.isEnabled()).toBe(true);
		});

		it('should return false when not initialized', () => {
			expect(service.isEnabled()).toBe(false);
		});

		it('should return false when initialized but underlying service is disabled', async () => {
			// Initialize first
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'localhost:9092';

			const serverStartedHandler = mockEventService.on.mock.calls.find(
				(call) => call[0] === 'server-started',
			)?.[1] as () => Promise<void>;
			await serverStartedHandler();

			mockKafkaExecutionLogger.isEnabled.mockReturnValue(false);

			expect(service.isEnabled()).toBe(false);
		});
	});

	describe('getKafkaExecutionLogger', () => {
		it('should return the underlying KafkaExecutionLogger instance', () => {
			const result = service.getKafkaExecutionLogger();
			expect(result).toBe(mockKafkaExecutionLogger);
		});
	});
});
