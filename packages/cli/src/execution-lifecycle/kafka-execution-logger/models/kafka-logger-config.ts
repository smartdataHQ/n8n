/**
 * Configuration interface for the Kafka Execution Logger
 */
export interface KafkaLoggerConfig {
	enabled: boolean;
	kafka: {
		brokers: string[];
		clientId: string;
		topic: string;
		ssl: boolean;
		authentication?: {
			username: string;
			password: string;
			mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
		};
	};
	queue: {
		maxSize: number;
		batchSize: number;
		flushInterval: number;
	};
	circuitBreaker: {
		failureThreshold: number;
		resetTimeout: number;
		monitoringPeriod: number;
	};
	timeouts: {
		connect: number;
		send: number;
		disconnect: number;
	};
}
