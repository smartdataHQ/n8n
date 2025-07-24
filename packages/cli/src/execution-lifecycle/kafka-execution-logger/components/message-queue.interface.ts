import type { ExecutionLogMessage } from '../models';

/**
 * Interface for in-memory message queue with overflow protection
 */
export interface IMessageQueue {
	/**
	 * Add a message to the queue
	 * @param message The message to enqueue
	 * @returns true if message was added, false if queue is full
	 */
	enqueue(message: ExecutionLogMessage): boolean;

	/**
	 * Remove and return the oldest message from the queue
	 * @returns The oldest message or null if queue is empty
	 */
	dequeue(): ExecutionLogMessage | null;

	/**
	 * Remove and return multiple messages from the queue
	 * @param size Maximum number of messages to dequeue
	 * @returns Array of messages (may be fewer than requested)
	 */
	dequeueBatch(size: number): ExecutionLogMessage[];

	/**
	 * Get the current number of messages in the queue
	 * @returns Current queue size
	 */
	size(): number;

	/**
	 * Remove all messages from the queue
	 */
	clear(): void;
}
