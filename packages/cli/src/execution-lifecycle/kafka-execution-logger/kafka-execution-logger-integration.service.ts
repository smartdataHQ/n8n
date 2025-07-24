import { OnShutdown } from '@n8n/decorators';
import { Service } from '@n8n/di';
import { Logger } from '@n8n/backend-common';

import { EventService } from '@/events/event.service';

import { KafkaExecutionLogger } from './services/kafka-execution-logger.service';
import { KafkaConfigLoader } from './utils/config-loader';

/**
 * Integration service for KafkaExecutionLogger
 * Handles service registration, startup initialization, and shutdown cleanup
 */
@Service()
export class KafkaExecutionLoggerIntegrationService {
	private isInitialized = false;

	constructor(
		private readonly logger: Logger,
		private readonly eventService: EventService,
		private readonly kafkaExecutionLogger: KafkaExecutionLogger,
		private readonly configLoader: KafkaConfigLoader,
	) {
		this.setupEventListeners();
	}

	/**
	 * Set up event listeners for server lifecycle events
	 */
	private setupEventListeners(): void {
		this.eventService.on('server-started', async () => {
			await this.initializeService();
		});
	}

	/**
	 * Initialize the Kafka Execution Logger service if configured
	 */
	private async initializeService(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		try {
			// Load configuration to check if service should be enabled
			const config = this.configLoader.loadConfig();

			// Check if Kafka cluster connection has been configured
			if (!this.isKafkaConfigured(config)) {
				this.logger.warn(
					'Kafka Execution Logger is not configured. Set N8N_KAFKA_LOGGER_ENABLED=true and configure Kafka brokers to enable execution logging.',
					{
						requiredEnvVars: [
							'N8N_KAFKA_LOGGER_ENABLED=true',
							'N8N_KAFKA_LOGGER_BROKERS=localhost:9092',
						],
					},
				);
				return;
			}

			// Check if service is enabled via configuration
			if (!config.enabled) {
				this.logger.info('Kafka Execution Logger is disabled via configuration');
				return;
			}

			// Initialize the service
			await this.kafkaExecutionLogger.initialize();
			this.isInitialized = true;

			this.logger.info('Kafka Execution Logger integration service initialized successfully');
		} catch (error) {
			this.logger.error('Failed to initialize Kafka Execution Logger integration service', {
				error,
			});
			// Don't throw - service initialization failure should not prevent n8n startup
		}
	}

	/**
	 * Check if Kafka has been properly configured
	 */
	private isKafkaConfigured(config: any): boolean {
		// Service is considered configured if:
		// 1. It's explicitly enabled, AND
		// 2. Brokers are configured (not just defaults)
		const hasExplicitEnable = process.env.N8N_KAFKA_LOGGER_ENABLED === 'true';
		const hasCustomBrokers = process.env.N8N_KAFKA_LOGGER_BROKERS !== undefined;

		return hasExplicitEnable && (hasCustomBrokers || config.kafka.brokers.length > 0);
	}

	/**
	 * Shutdown the service during n8n shutdown
	 */
	@OnShutdown()
	async shutdown(): Promise<void> {
		if (!this.isInitialized) {
			return;
		}

		try {
			this.logger.info('Shutting down Kafka Execution Logger integration service...');
			await this.kafkaExecutionLogger.shutdown();
			this.isInitialized = false;
			this.logger.info('Kafka Execution Logger integration service shutdown completed');
		} catch (error) {
			this.logger.error('Error during Kafka Execution Logger integration service shutdown', {
				error,
			});
		}
	}

	/**
	 * Check if the service is initialized and enabled
	 */
	isEnabled(): boolean {
		return this.isInitialized && this.kafkaExecutionLogger.isEnabled();
	}

	/**
	 * Get the underlying KafkaExecutionLogger service instance
	 * Used for registering lifecycle hooks with workflow execution
	 */
	getKafkaExecutionLogger(): KafkaExecutionLogger {
		return this.kafkaExecutionLogger;
	}
}
