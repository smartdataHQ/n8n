import { Service } from '@n8n/di';
import type { KafkaLoggerConfig } from '../models/kafka-logger-config';

/**
 * Configuration loader for Kafka Execution Logger
 * Reads environment variables and provides validated configuration with defaults
 *
 * Supported Environment Variables:
 * - N8N_KAFKA_LOGGER_ENABLED: Enable/disable the logger (default: false)
 * - N8N_KAFKA_LOGGER_BROKERS: Comma-separated list of Kafka brokers (default: localhost:9092)
 * - N8N_KAFKA_LOGGER_CLIENT_ID: Kafka client ID (default: n8n-execution-logger)
 * - N8N_KAFKA_LOGGER_TOPIC: Kafka topic name (default: n8n-executions)
 * - N8N_KAFKA_LOGGER_SSL: Enable SSL/TLS (default: false)
 * - N8N_KAFKA_LOGGER_AUTH_ENABLED: Enable authentication (default: false)
 * - N8N_KAFKA_LOGGER_USERNAME: SASL username (required if auth enabled)
 * - N8N_KAFKA_LOGGER_PASSWORD: SASL password (required if auth enabled)
 * - N8N_KAFKA_LOGGER_SASL_MECHANISM: SASL mechanism (default: plain)
 * - N8N_KAFKA_LOGGER_QUEUE_MAX_SIZE: Max queue size (default: 10000)
 * - N8N_KAFKA_LOGGER_QUEUE_BATCH_SIZE: Batch size for processing (default: 100)
 * - N8N_KAFKA_LOGGER_QUEUE_FLUSH_INTERVAL: Flush interval in ms (default: 5000)
 * - N8N_KAFKA_LOGGER_CB_FAILURE_THRESHOLD: Circuit breaker failure threshold (default: 5)
 * - N8N_KAFKA_LOGGER_CB_RESET_TIMEOUT: Circuit breaker reset timeout in ms (default: 60000)
 * - N8N_KAFKA_LOGGER_CB_MONITORING_PERIOD: Circuit breaker monitoring period in ms (default: 30000)
 * - N8N_KAFKA_LOGGER_TIMEOUT_CONNECT: Connection timeout in ms (default: 10000)
 * - N8N_KAFKA_LOGGER_TIMEOUT_SEND: Send timeout in ms (default: 5000)
 * - N8N_KAFKA_LOGGER_TIMEOUT_DISCONNECT: Disconnect timeout in ms (default: 5000)
 */
@Service()
export class KafkaConfigLoader {
	/**
	 * Load and validate Kafka logger configuration from environment variables
	 */
	loadConfig(): KafkaLoggerConfig {
		const config: KafkaLoggerConfig = {
			enabled: this.parseBoolean('N8N_KAFKA_LOGGER_ENABLED', false),
			kafka: {
				brokers: this.parseBrokers('N8N_KAFKA_LOGGER_BROKERS', ['localhost:9092']),
				clientId: this.parseString('N8N_KAFKA_LOGGER_CLIENT_ID', 'n8n-execution-logger'),
				topic: this.parseString('N8N_KAFKA_LOGGER_TOPIC', 'n8n-executions'),
				ssl: this.parseBoolean('N8N_KAFKA_LOGGER_SSL', false),
				authentication: this.parseAuthentication(),
			},
			queue: {
				maxSize: this.parseNumber('N8N_KAFKA_LOGGER_QUEUE_MAX_SIZE', 10000),
				batchSize: this.parseNumber('N8N_KAFKA_LOGGER_QUEUE_BATCH_SIZE', 100),
				flushInterval: this.parseNumber('N8N_KAFKA_LOGGER_QUEUE_FLUSH_INTERVAL', 5000),
			},
			circuitBreaker: {
				failureThreshold: this.parseNumber('N8N_KAFKA_LOGGER_CB_FAILURE_THRESHOLD', 5),
				resetTimeout: this.parseNumber('N8N_KAFKA_LOGGER_CB_RESET_TIMEOUT', 60000),
				monitoringPeriod: this.parseNumber('N8N_KAFKA_LOGGER_CB_MONITORING_PERIOD', 30000),
			},
			timeouts: {
				connect: this.parseNumber('N8N_KAFKA_LOGGER_TIMEOUT_CONNECT', 10000),
				send: this.parseNumber('N8N_KAFKA_LOGGER_TIMEOUT_SEND', 5000),
				disconnect: this.parseNumber('N8N_KAFKA_LOGGER_TIMEOUT_DISCONNECT', 5000),
			},
		};

		this.validateConfig(config);
		return config;
	}

	/**
	 * Parse boolean environment variable
	 */
	private parseBoolean(envVar: string, defaultValue: boolean): boolean {
		const value = process.env[envVar];
		if (value === undefined) return defaultValue;
		return value.toLowerCase() === 'true';
	}

	/**
	 * Parse string environment variable
	 */
	private parseString(envVar: string, defaultValue: string): string {
		return process.env[envVar] ?? defaultValue;
	}

	/**
	 * Parse number environment variable
	 */
	private parseNumber(envVar: string, defaultValue: number): number {
		const value = process.env[envVar];
		if (value === undefined) return defaultValue;

		const parsed = parseInt(value, 10);
		if (isNaN(parsed)) {
			throw new Error(`Invalid number value for ${envVar}: ${value}`);
		}
		return parsed;
	}

	/**
	 * Parse Kafka brokers from comma-separated string
	 */
	private parseBrokers(envVar: string, defaultValue: string[]): string[] {
		const value = process.env[envVar];
		if (value === undefined) return defaultValue;
		if (value === '') return [];

		return value
			.split(',')
			.map((broker) => broker.trim())
			.filter((broker) => broker.length > 0);
	}

	/**
	 * Parse authentication configuration
	 */
	private parseAuthentication(): KafkaLoggerConfig['kafka']['authentication'] {
		const authEnabled = this.parseBoolean('N8N_KAFKA_LOGGER_AUTH_ENABLED', false);

		if (!authEnabled) {
			return undefined;
		}

		const username = this.parseString('N8N_KAFKA_LOGGER_USERNAME', '');
		const password = this.parseString('N8N_KAFKA_LOGGER_PASSWORD', '');
		const mechanism = this.parseSaslMechanism('N8N_KAFKA_LOGGER_SASL_MECHANISM', 'plain');

		if (!username || !password) {
			throw new Error('Authentication is enabled but username or password is missing');
		}

		return {
			username,
			password,
			mechanism,
		};
	}

	/**
	 * Parse SASL mechanism
	 */
	private parseSaslMechanism(
		envVar: string,
		defaultValue: 'plain' | 'scram-sha-256' | 'scram-sha-512',
	): 'plain' | 'scram-sha-256' | 'scram-sha-512' {
		const value = process.env[envVar] as 'plain' | 'scram-sha-256' | 'scram-sha-512';

		if (!value) return defaultValue;

		const validMechanisms: Array<'plain' | 'scram-sha-256' | 'scram-sha-512'> = [
			'plain',
			'scram-sha-256',
			'scram-sha-512',
		];

		if (!validMechanisms.includes(value)) {
			throw new Error(
				`Invalid SASL mechanism: ${value}. Valid values: ${validMechanisms.join(', ')}`,
			);
		}

		return value;
	}

	/**
	 * Validate the loaded configuration
	 */
	private validateConfig(config: KafkaLoggerConfig): void {
		// Validate brokers
		if (config.kafka.brokers.length === 0) {
			throw new Error('At least one Kafka broker must be specified');
		}

		// Validate broker format
		for (const broker of config.kafka.brokers) {
			if (!broker.includes(':')) {
				throw new Error(`Invalid broker format: ${broker}. Expected format: host:port`);
			}
		}

		// Validate topic name
		if (!config.kafka.topic || config.kafka.topic.trim().length === 0) {
			throw new Error('Kafka topic name cannot be empty');
		}

		// Validate client ID
		if (!config.kafka.clientId || config.kafka.clientId.trim().length === 0) {
			throw new Error('Kafka client ID cannot be empty');
		}

		// Validate queue configuration
		if (config.queue.maxSize <= 0) {
			throw new Error('Queue max size must be greater than 0');
		}

		if (config.queue.batchSize <= 0) {
			throw new Error('Queue batch size must be greater than 0');
		}

		if (config.queue.batchSize > config.queue.maxSize) {
			throw new Error('Queue batch size cannot be greater than max size');
		}

		if (config.queue.flushInterval <= 0) {
			throw new Error('Queue flush interval must be greater than 0');
		}

		// Validate circuit breaker configuration
		if (config.circuitBreaker.failureThreshold <= 0) {
			throw new Error('Circuit breaker failure threshold must be greater than 0');
		}

		if (config.circuitBreaker.resetTimeout <= 0) {
			throw new Error('Circuit breaker reset timeout must be greater than 0');
		}

		if (config.circuitBreaker.monitoringPeriod <= 0) {
			throw new Error('Circuit breaker monitoring period must be greater than 0');
		}

		// Validate timeout configuration
		if (config.timeouts.connect <= 0) {
			throw new Error('Connect timeout must be greater than 0');
		}

		if (config.timeouts.send <= 0) {
			throw new Error('Send timeout must be greater than 0');
		}

		if (config.timeouts.disconnect <= 0) {
			throw new Error('Disconnect timeout must be greater than 0');
		}
	}
}
