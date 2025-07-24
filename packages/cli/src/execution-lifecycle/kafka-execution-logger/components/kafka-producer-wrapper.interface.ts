import type { ExecutionLogMessage } from '../models';

/**
 * Interface for Kafka producer wrapper with timeout and error handling
 */
export interface IKafkaProducerWrapper {
	/**
	 * Connect to Kafka cluster
	 * @throws Error if connection fails
	 */
	connect(): Promise<void>;

	/**
	 * Disconnect from Kafka cluster
	 */
	disconnect(): Promise<void>;

	/**
	 * Send a single message to Kafka
	 * @param message The message to send
	 * @throws Error if send fails or times out
	 */
	send(message: ExecutionLogMessage): Promise<void>;

	/**
	 * Send multiple messages to Kafka in a batch
	 * @param messages Array of messages to send
	 * @throws Error if batch send fails or times out
	 */
	sendBatch(messages: ExecutionLogMessage[]): Promise<void>;

	/**
	 * Check if the producer is currently connected
	 * @returns true if connected, false otherwise
	 */
	isConnected(): boolean;
}
