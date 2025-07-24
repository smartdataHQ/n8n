import { KafkaConfigLoader } from '../utils/config-loader';

describe('KafkaConfigLoader', () => {
	let configLoader: KafkaConfigLoader;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		configLoader = new KafkaConfigLoader();
		originalEnv = { ...process.env };
		// Clear all Kafka-related environment variables
		Object.keys(process.env).forEach((key) => {
			if (key.startsWith('N8N_KAFKA_LOGGER_')) {
				delete process.env[key];
			}
		});
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('loadConfig', () => {
		it('should return default configuration when no environment variables are set', () => {
			const config = configLoader.loadConfig();

			expect(config).toEqual({
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
		});

		it('should parse boolean environment variables correctly', () => {
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_SSL = 'true';

			const config = configLoader.loadConfig();

			expect(config.enabled).toBe(true);
			expect(config.kafka.ssl).toBe(true);
		});

		it('should parse boolean environment variables as false for non-true values', () => {
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'false';
			process.env.N8N_KAFKA_LOGGER_SSL = 'no';

			const config = configLoader.loadConfig();

			expect(config.enabled).toBe(false);
			expect(config.kafka.ssl).toBe(false);
		});

		it('should parse string environment variables correctly', () => {
			process.env.N8N_KAFKA_LOGGER_CLIENT_ID = 'custom-client-id';
			process.env.N8N_KAFKA_LOGGER_TOPIC = 'custom-topic';

			const config = configLoader.loadConfig();

			expect(config.kafka.clientId).toBe('custom-client-id');
			expect(config.kafka.topic).toBe('custom-topic');
		});

		it('should parse number environment variables correctly', () => {
			process.env.N8N_KAFKA_LOGGER_QUEUE_MAX_SIZE = '5000';
			process.env.N8N_KAFKA_LOGGER_TIMEOUT_CONNECT = '15000';

			const config = configLoader.loadConfig();

			expect(config.queue.maxSize).toBe(5000);
			expect(config.timeouts.connect).toBe(15000);
		});

		it('should throw error for invalid number environment variables', () => {
			process.env.N8N_KAFKA_LOGGER_QUEUE_MAX_SIZE = 'invalid-number';

			expect(() => configLoader.loadConfig()).toThrow(
				'Invalid number value for N8N_KAFKA_LOGGER_QUEUE_MAX_SIZE: invalid-number',
			);
		});

		it('should parse comma-separated brokers correctly', () => {
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'broker1:9092,broker2:9092,broker3:9092';

			const config = configLoader.loadConfig();

			expect(config.kafka.brokers).toEqual(['broker1:9092', 'broker2:9092', 'broker3:9092']);
		});

		it('should handle brokers with extra whitespace', () => {
			process.env.N8N_KAFKA_LOGGER_BROKERS = ' broker1:9092 , broker2:9092 , broker3:9092 ';

			const config = configLoader.loadConfig();

			expect(config.kafka.brokers).toEqual(['broker1:9092', 'broker2:9092', 'broker3:9092']);
		});

		it('should filter out empty broker entries', () => {
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'broker1:9092,,broker2:9092,';

			const config = configLoader.loadConfig();

			expect(config.kafka.brokers).toEqual(['broker1:9092', 'broker2:9092']);
		});
	});

	describe('authentication configuration', () => {
		it('should return undefined authentication when auth is disabled', () => {
			process.env.N8N_KAFKA_LOGGER_AUTH_ENABLED = 'false';

			const config = configLoader.loadConfig();

			expect(config.kafka.authentication).toBeUndefined();
		});

		it('should parse authentication configuration when enabled', () => {
			process.env.N8N_KAFKA_LOGGER_AUTH_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_USERNAME = 'test-user';
			process.env.N8N_KAFKA_LOGGER_PASSWORD = 'test-password';
			process.env.N8N_KAFKA_LOGGER_SASL_MECHANISM = 'scram-sha-256';

			const config = configLoader.loadConfig();

			expect(config.kafka.authentication).toEqual({
				username: 'test-user',
				password: 'test-password',
				mechanism: 'scram-sha-256',
			});
		});

		it('should use default SASL mechanism when not specified', () => {
			process.env.N8N_KAFKA_LOGGER_AUTH_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_USERNAME = 'test-user';
			process.env.N8N_KAFKA_LOGGER_PASSWORD = 'test-password';

			const config = configLoader.loadConfig();

			expect(config.kafka.authentication?.mechanism).toBe('plain');
		});

		it('should throw error when authentication is enabled but username is missing', () => {
			process.env.N8N_KAFKA_LOGGER_AUTH_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_PASSWORD = 'test-password';

			expect(() => configLoader.loadConfig()).toThrow(
				'Authentication is enabled but username or password is missing',
			);
		});

		it('should throw error when authentication is enabled but password is missing', () => {
			process.env.N8N_KAFKA_LOGGER_AUTH_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_USERNAME = 'test-user';

			expect(() => configLoader.loadConfig()).toThrow(
				'Authentication is enabled but username or password is missing',
			);
		});

		it('should throw error for invalid SASL mechanism', () => {
			process.env.N8N_KAFKA_LOGGER_AUTH_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_USERNAME = 'test-user';
			process.env.N8N_KAFKA_LOGGER_PASSWORD = 'test-password';
			process.env.N8N_KAFKA_LOGGER_SASL_MECHANISM = 'invalid-mechanism';

			expect(() => configLoader.loadConfig()).toThrow(
				'Invalid SASL mechanism: invalid-mechanism. Valid values: plain, scram-sha-256, scram-sha-512',
			);
		});

		it('should accept all valid SASL mechanisms', () => {
			const validMechanisms = ['plain', 'scram-sha-256', 'scram-sha-512'];

			validMechanisms.forEach((mechanism) => {
				// Reset environment
				Object.keys(process.env).forEach((key) => {
					if (key.startsWith('N8N_KAFKA_LOGGER_')) {
						delete process.env[key];
					}
				});

				process.env.N8N_KAFKA_LOGGER_AUTH_ENABLED = 'true';
				process.env.N8N_KAFKA_LOGGER_USERNAME = 'test-user';
				process.env.N8N_KAFKA_LOGGER_PASSWORD = 'test-password';
				process.env.N8N_KAFKA_LOGGER_SASL_MECHANISM = mechanism;

				const config = configLoader.loadConfig();
				expect(config.kafka.authentication?.mechanism).toBe(mechanism);
			});
		});
	});

	describe('configuration validation', () => {
		it('should throw error when no brokers are specified', () => {
			process.env.N8N_KAFKA_LOGGER_BROKERS = '';

			expect(() => configLoader.loadConfig()).toThrow(
				'At least one Kafka broker must be specified',
			);
		});

		it('should throw error for invalid broker format', () => {
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'invalid-broker-format';

			expect(() => configLoader.loadConfig()).toThrow(
				'Invalid broker format: invalid-broker-format. Expected format: host:port',
			);
		});

		it('should throw error for empty topic name', () => {
			process.env.N8N_KAFKA_LOGGER_TOPIC = '';

			expect(() => configLoader.loadConfig()).toThrow('Kafka topic name cannot be empty');
		});

		it('should throw error for empty client ID', () => {
			process.env.N8N_KAFKA_LOGGER_CLIENT_ID = '';

			expect(() => configLoader.loadConfig()).toThrow('Kafka client ID cannot be empty');
		});

		it('should throw error for invalid queue max size', () => {
			process.env.N8N_KAFKA_LOGGER_QUEUE_MAX_SIZE = '0';

			expect(() => configLoader.loadConfig()).toThrow('Queue max size must be greater than 0');
		});

		it('should throw error for invalid queue batch size', () => {
			process.env.N8N_KAFKA_LOGGER_QUEUE_BATCH_SIZE = '0';

			expect(() => configLoader.loadConfig()).toThrow('Queue batch size must be greater than 0');
		});

		it('should throw error when batch size is greater than max size', () => {
			process.env.N8N_KAFKA_LOGGER_QUEUE_MAX_SIZE = '100';
			process.env.N8N_KAFKA_LOGGER_QUEUE_BATCH_SIZE = '200';

			expect(() => configLoader.loadConfig()).toThrow(
				'Queue batch size cannot be greater than max size',
			);
		});

		it('should throw error for invalid flush interval', () => {
			process.env.N8N_KAFKA_LOGGER_QUEUE_FLUSH_INTERVAL = '0';

			expect(() => configLoader.loadConfig()).toThrow(
				'Queue flush interval must be greater than 0',
			);
		});

		it('should throw error for invalid circuit breaker failure threshold', () => {
			process.env.N8N_KAFKA_LOGGER_CB_FAILURE_THRESHOLD = '0';

			expect(() => configLoader.loadConfig()).toThrow(
				'Circuit breaker failure threshold must be greater than 0',
			);
		});

		it('should throw error for invalid circuit breaker reset timeout', () => {
			process.env.N8N_KAFKA_LOGGER_CB_RESET_TIMEOUT = '0';

			expect(() => configLoader.loadConfig()).toThrow(
				'Circuit breaker reset timeout must be greater than 0',
			);
		});

		it('should throw error for invalid circuit breaker monitoring period', () => {
			process.env.N8N_KAFKA_LOGGER_CB_MONITORING_PERIOD = '0';

			expect(() => configLoader.loadConfig()).toThrow(
				'Circuit breaker monitoring period must be greater than 0',
			);
		});

		it('should throw error for invalid connect timeout', () => {
			process.env.N8N_KAFKA_LOGGER_TIMEOUT_CONNECT = '0';

			expect(() => configLoader.loadConfig()).toThrow('Connect timeout must be greater than 0');
		});

		it('should throw error for invalid send timeout', () => {
			process.env.N8N_KAFKA_LOGGER_TIMEOUT_SEND = '0';

			expect(() => configLoader.loadConfig()).toThrow('Send timeout must be greater than 0');
		});

		it('should throw error for invalid disconnect timeout', () => {
			process.env.N8N_KAFKA_LOGGER_TIMEOUT_DISCONNECT = '0';

			expect(() => configLoader.loadConfig()).toThrow('Disconnect timeout must be greater than 0');
		});
	});

	describe('complete configuration parsing', () => {
		it('should parse all environment variables correctly', () => {
			// Set all environment variables
			process.env.N8N_KAFKA_LOGGER_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_BROKERS = 'broker1:9092,broker2:9092';
			process.env.N8N_KAFKA_LOGGER_CLIENT_ID = 'custom-client';
			process.env.N8N_KAFKA_LOGGER_TOPIC = 'custom-topic';
			process.env.N8N_KAFKA_LOGGER_SSL = 'true';
			process.env.N8N_KAFKA_LOGGER_AUTH_ENABLED = 'true';
			process.env.N8N_KAFKA_LOGGER_USERNAME = 'kafka-user';
			process.env.N8N_KAFKA_LOGGER_PASSWORD = 'kafka-password';
			process.env.N8N_KAFKA_LOGGER_SASL_MECHANISM = 'scram-sha-512';
			process.env.N8N_KAFKA_LOGGER_QUEUE_MAX_SIZE = '20000';
			process.env.N8N_KAFKA_LOGGER_QUEUE_BATCH_SIZE = '200';
			process.env.N8N_KAFKA_LOGGER_QUEUE_FLUSH_INTERVAL = '10000';
			process.env.N8N_KAFKA_LOGGER_CB_FAILURE_THRESHOLD = '10';
			process.env.N8N_KAFKA_LOGGER_CB_RESET_TIMEOUT = '120000';
			process.env.N8N_KAFKA_LOGGER_CB_MONITORING_PERIOD = '60000';
			process.env.N8N_KAFKA_LOGGER_TIMEOUT_CONNECT = '20000';
			process.env.N8N_KAFKA_LOGGER_TIMEOUT_SEND = '10000';
			process.env.N8N_KAFKA_LOGGER_TIMEOUT_DISCONNECT = '10000';

			const config = configLoader.loadConfig();

			expect(config).toEqual({
				enabled: true,
				kafka: {
					brokers: ['broker1:9092', 'broker2:9092'],
					clientId: 'custom-client',
					topic: 'custom-topic',
					ssl: true,
					authentication: {
						username: 'kafka-user',
						password: 'kafka-password',
						mechanism: 'scram-sha-512',
					},
				},
				queue: {
					maxSize: 20000,
					batchSize: 200,
					flushInterval: 10000,
				},
				circuitBreaker: {
					failureThreshold: 10,
					resetTimeout: 120000,
					monitoringPeriod: 60000,
				},
				timeouts: {
					connect: 20000,
					send: 10000,
					disconnect: 10000,
				},
			});
		});
	});
});
