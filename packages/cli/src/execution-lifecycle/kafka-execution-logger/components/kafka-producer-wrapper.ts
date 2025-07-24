import type { KafkaConfig, Producer, SASLOptions } from 'kafkajs';
import { Kafka } from 'kafkajs';
import { Service } from '@n8n/di';
import type { Logger } from '@n8n/backend-common';

import type { ExecutionLogMessage, KafkaLoggerConfig } from '../models';
import type { IKafkaProducerWrapper } from './kafka-producer-wrapper.interface';

/**
 * Safe Kafka producer wrapper with timeout handling and connection lifecycle management
 */
@Service()
export class KafkaProducerWrapper implements IKafkaProducerWrapper {
	private producer: Producer | null = null;

	private kafka: Kafka | null = null;

	private connected = false;

	private readonly config: KafkaLoggerConfig;

	constructor(
		config: KafkaLoggerConfig,
		private readonly logger: Logger,
	) {
		this.config = config;
	}

	/**
	 * Connect to Kafka cluster with timeout handling
	 */
	async connect(): Promise<void> {
		if (this.connected) {
			return;
		}

		try {
			// Build Kafka configuration
			const kafkaConfig: KafkaConfig = {
				clientId: this.config.kafka.clientId,
				brokers: this.config.kafka.brokers,
				connectionTimeout: this.config.timeouts.connect,
				requestTimeout: this.config.timeouts.send,
				ssl: this.config.kafka.ssl,
			};

			// Add authentication if configured
			if (this.config.kafka.authentication) {
				const saslConfig: SASLOptions = {
					mechanism: this.config.kafka.authentication.mechanism,
					username: this.config.kafka.authentication.username,
					password: this.config.kafka.authentication.password,
				};
				kafkaConfig.sasl = saslConfig;
			}

			// Create Kafka instance and producer
			this.kafka = new Kafka(kafkaConfig);
			this.producer = this.kafka.producer();

			// Connect with timeout
			await this.withTimeout(
				this.producer.connect(),
				this.config.timeouts.connect,
				'Kafka producer connection timeout',
			);

			this.connected = true;
		} catch (error) {
			// Clean up on connection failure
			await this.cleanup();

			// Enhance error message with more context
			const errorMessage = error instanceof Error ? error.message : String(error);
			const enhancedError = new Error(`Failed to connect to Kafka: ${errorMessage}`);

			// Add additional context for better error categorization
			if (
				errorMessage.toLowerCase().includes('authentication') ||
				errorMessage.toLowerCase().includes('sasl') ||
				errorMessage.toLowerCase().includes('unauthorized')
			) {
				enhancedError.name = 'KafkaAuthenticationError';
			} else if (
				errorMessage.toLowerCase().includes('timeout') ||
				errorMessage.toLowerCase().includes('timed out')
			) {
				enhancedError.name = 'KafkaTimeoutError';
			} else if (
				errorMessage.toLowerCase().includes('connection') ||
				errorMessage.toLowerCase().includes('econnrefused') ||
				errorMessage.toLowerCase().includes('enotfound')
			) {
				enhancedError.name = 'KafkaConnectionError';
			} else {
				enhancedError.name = 'KafkaError';
			}

			throw enhancedError;
		}
	}

	/**
	 * Disconnect from Kafka cluster with timeout handling
	 */
	async disconnect(): Promise<void> {
		if (!this.connected || !this.producer) {
			return;
		}

		try {
			await this.withTimeout(
				this.producer.disconnect(),
				this.config.timeouts.disconnect,
				'Kafka producer disconnect timeout',
			);
		} catch (error) {
			// Log error but don't throw - we're disconnecting anyway
			console.error('Error during Kafka producer disconnect:', error);
		} finally {
			await this.cleanup();
		}
	}

	/**
	 * Send a single message to Kafka with timeout handling
	 */
	async send(message: ExecutionLogMessage): Promise<void> {
		if (!this.connected || !this.producer) {
			throw new Error('Kafka producer is not connected');
		}

		try {
			const serializedMessage = JSON.stringify(message);

			await this.withTimeout(
				this.producer.send({
					topic: this.config.kafka.topic,
					messages: [
						{
							key: message.messageId,
							value: serializedMessage,
							timestamp: new Date(message.timestamp).getTime().toString(),
						},
					],
				}),
				this.config.timeouts.send,
				'Kafka message send timeout',
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const enhancedError = new Error(`Failed to send message to Kafka: ${errorMessage}`);

			// Add context for error categorization
			if (
				errorMessage.toLowerCase().includes('timeout') ||
				errorMessage.toLowerCase().includes('timed out')
			) {
				enhancedError.name = 'KafkaTimeoutError';
			} else if (
				errorMessage.toLowerCase().includes('topic') &&
				errorMessage.toLowerCase().includes('not') &&
				errorMessage.toLowerCase().includes('exist')
			) {
				enhancedError.name = 'KafkaTopicError';
			} else if (
				errorMessage.toLowerCase().includes('serialization') ||
				errorMessage.toLowerCase().includes('invalid message')
			) {
				enhancedError.name = 'KafkaSerializationError';
			} else {
				enhancedError.name = 'KafkaMessageSendError';
			}

			throw enhancedError;
		}
	}

	/**
	 * Send multiple messages to Kafka in a batch with timeout handling
	 */
	async sendBatch(messages: ExecutionLogMessage[]): Promise<void> {
		if (!this.connected || !this.producer) {
			throw new Error('Kafka producer is not connected');
		}

		if (messages.length === 0) {
			return;
		}

		try {
			const kafkaMessages = messages.map((message) => ({
				key: message.messageId,
				value: JSON.stringify(message),
				timestamp: new Date(message.timestamp).getTime().toString(),
			}));

			await this.withTimeout(
				this.producer.send({
					topic: this.config.kafka.topic,
					messages: kafkaMessages,
				}),
				this.config.timeouts.send,
				'Kafka batch send timeout',
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const enhancedError = new Error(`Failed to send batch messages to Kafka: ${errorMessage}`);

			// Add context for error categorization
			if (
				errorMessage.toLowerCase().includes('timeout') ||
				errorMessage.toLowerCase().includes('timed out')
			) {
				enhancedError.name = 'KafkaTimeoutError';
			} else if (
				errorMessage.toLowerCase().includes('topic') &&
				errorMessage.toLowerCase().includes('not') &&
				errorMessage.toLowerCase().includes('exist')
			) {
				enhancedError.name = 'KafkaTopicError';
			} else if (
				errorMessage.toLowerCase().includes('serialization') ||
				errorMessage.toLowerCase().includes('invalid message')
			) {
				enhancedError.name = 'KafkaSerializationError';
			} else {
				enhancedError.name = 'KafkaMessageSendError';
			}

			throw enhancedError;
		}
	}

	/**
	 * Check if the producer is currently connected
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Utility method to wrap operations with timeout
	 */
	private async withTimeout<T>(
		operation: Promise<T>,
		timeoutMs: number,
		timeoutMessage: string,
	): Promise<T> {
		// Handle case where operation is not a valid Promise
		if (!operation || typeof operation.then !== 'function') {
			throw new Error('Invalid operation provided to withTimeout');
		}

		return await new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error(timeoutMessage));
			}, timeoutMs);

			operation
				.then((result) => {
					clearTimeout(timeoutId);
					resolve(result);
				})
				.catch((error) => {
					clearTimeout(timeoutId);
					reject(error);
				});
		});
	}

	/**
	 * Clean up resources
	 */
	private async cleanup(): Promise<void> {
		this.connected = false;
		this.producer = null;
		this.kafka = null;
	}
}
