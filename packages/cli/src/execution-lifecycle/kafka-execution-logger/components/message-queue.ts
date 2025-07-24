import type { ExecutionLogMessage } from '../models';
import type { IMessageQueue } from './message-queue.interface';

/**
 * In-memory FIFO message queue with size limits and overflow protection
 *
 * Features:
 * - FIFO (First In, First Out) ordering
 * - Configurable maximum size
 * - Overflow handling by dropping oldest messages
 * - Batch dequeue functionality for efficient processing
 */
export class MessageQueue implements IMessageQueue {
	private readonly messages: ExecutionLogMessage[] = [];
	private readonly maxSize: number;

	constructor(maxSize: number = 10000) {
		if (maxSize <= 0) {
			throw new Error('Queue max size must be greater than 0');
		}
		this.maxSize = maxSize;
	}

	/**
	 * Add a message to the queue
	 * If queue is at capacity, removes oldest message to make room
	 * @param message The message to enqueue
	 * @returns true if message was added, false if queue was full and oldest message was dropped
	 */
	enqueue(message: ExecutionLogMessage): boolean {
		let wasDropped = false;

		// If queue is at capacity, remove oldest message (FIFO overflow handling)
		if (this.messages.length >= this.maxSize) {
			this.messages.shift(); // Remove oldest message
			wasDropped = true;
		}

		// Add new message to end of queue
		this.messages.push(message);

		// Return false if we had to drop a message due to overflow
		return !wasDropped;
	}

	/**
	 * Remove and return the oldest message from the queue
	 * @returns The oldest message or null if queue is empty
	 */
	dequeue(): ExecutionLogMessage | null {
		return this.messages.shift() || null;
	}

	/**
	 * Remove and return multiple messages from the queue
	 * Returns messages in FIFO order (oldest first)
	 * @param size Maximum number of messages to dequeue
	 * @returns Array of messages (may be fewer than requested if queue has fewer messages)
	 */
	dequeueBatch(size: number): ExecutionLogMessage[] {
		if (size <= 0) {
			return [];
		}

		// Take up to 'size' messages from the front of the queue
		const batchSize = Math.min(size, this.messages.length);
		return this.messages.splice(0, batchSize);
	}

	/**
	 * Get the current number of messages in the queue
	 * @returns Current queue size
	 */
	size(): number {
		return this.messages.length;
	}

	/**
	 * Remove all messages from the queue
	 */
	clear(): void {
		this.messages.length = 0;
	}

	/**
	 * Check if the queue is empty
	 * @returns true if queue has no messages
	 */
	isEmpty(): boolean {
		return this.messages.length === 0;
	}

	/**
	 * Check if the queue is at maximum capacity
	 * @returns true if queue is full
	 */
	isFull(): boolean {
		return this.messages.length >= this.maxSize;
	}

	/**
	 * Get the maximum capacity of the queue
	 * @returns Maximum queue size
	 */
	getMaxSize(): number {
		return this.maxSize;
	}
}
