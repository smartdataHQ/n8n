import { MessageQueue } from '../components/message-queue';
import type { ExecutionLogMessage } from '../models';

// Mock execution log message factory
const createMockMessage = (id: string): ExecutionLogMessage => ({
	type: 'track',
	event: 'Workflow Started',
	userId: 'user-123',
	timestamp: new Date().toISOString(),
	messageId: id,
	dimensions: {
		execution_mode: 'manual',
		workflow_name: 'Test Workflow',
	},
	flags: {
		is_manual_execution: true,
		is_retry: false,
	},
	metrics: {
		node_count: 5,
	},
	tags: ['test'],
	involves: [
		{
			role: 'WorkflowExecution',
			id: 'exec-123',
			id_type: 'n8n',
		},
		{
			role: 'Workflow',
			id: 'workflow-123',
			id_type: 'n8n',
		},
	],
	properties: {
		started_at: new Date().toISOString(),
	},
	context: {
		app: {
			name: 'n8n',
			version: '1.0.0',
		},
		library: {
			name: 'n8n-kafka-execution-logger',
			version: '1.0.0',
		},
		instance: {
			id: 'instance-123',
			type: 'main',
		},
		n8n: {
			execution_mode: 'manual',
			instance_type: 'main',
		},
	},
});

describe('MessageQueue', () => {
	let queue: MessageQueue;

	beforeEach(() => {
		queue = new MessageQueue(5); // Small queue for testing overflow scenarios
	});

	describe('constructor', () => {
		it('should create queue with default max size', () => {
			const defaultQueue = new MessageQueue();
			expect(defaultQueue.getMaxSize()).toBe(10000);
		});

		it('should create queue with custom max size', () => {
			const customQueue = new MessageQueue(100);
			expect(customQueue.getMaxSize()).toBe(100);
		});

		it('should throw error for invalid max size', () => {
			expect(() => new MessageQueue(0)).toThrow('Queue max size must be greater than 0');
			expect(() => new MessageQueue(-1)).toThrow('Queue max size must be greater than 0');
		});
	});

	describe('enqueue', () => {
		it('should add message to empty queue', () => {
			const message = createMockMessage('msg-1');
			const result = queue.enqueue(message);

			expect(result).toBe(true);
			expect(queue.size()).toBe(1);
			expect(queue.isEmpty()).toBe(false);
		});

		it('should add multiple messages in order', () => {
			const message1 = createMockMessage('msg-1');
			const message2 = createMockMessage('msg-2');

			queue.enqueue(message1);
			queue.enqueue(message2);

			expect(queue.size()).toBe(2);
		});

		it('should return true when message is successfully added', () => {
			const message = createMockMessage('msg-1');
			const result = queue.enqueue(message);

			expect(result).toBe(true);
		});

		it('should handle queue at capacity by dropping oldest message', () => {
			// Fill queue to capacity
			for (let i = 1; i <= 5; i++) {
				const result = queue.enqueue(createMockMessage(`msg-${i}`));
				expect(result).toBe(true);
			}

			expect(queue.size()).toBe(5);
			expect(queue.isFull()).toBe(true);

			// Add one more message - should drop oldest
			const result = queue.enqueue(createMockMessage('msg-6'));
			expect(result).toBe(false); // Returns false because oldest was dropped
			expect(queue.size()).toBe(5); // Size remains at max

			// Verify oldest message was dropped (msg-1 should be gone, msg-2 should be first)
			const firstMessage = queue.dequeue();
			expect(firstMessage?.messageId).toBe('msg-2');
		});

		it('should maintain FIFO order during overflow', () => {
			// Fill queue
			for (let i = 1; i <= 5; i++) {
				queue.enqueue(createMockMessage(`msg-${i}`));
			}

			// Add more messages causing overflow
			queue.enqueue(createMockMessage('msg-6'));
			queue.enqueue(createMockMessage('msg-7'));

			// Should have messages 3, 4, 5, 6, 7 (1 and 2 were dropped)
			expect(queue.dequeue()?.messageId).toBe('msg-3');
			expect(queue.dequeue()?.messageId).toBe('msg-4');
			expect(queue.dequeue()?.messageId).toBe('msg-5');
			expect(queue.dequeue()?.messageId).toBe('msg-6');
			expect(queue.dequeue()?.messageId).toBe('msg-7');
		});
	});

	describe('dequeue', () => {
		it('should return null for empty queue', () => {
			const result = queue.dequeue();
			expect(result).toBeNull();
		});

		it('should return and remove oldest message', () => {
			const message1 = createMockMessage('msg-1');
			const message2 = createMockMessage('msg-2');

			queue.enqueue(message1);
			queue.enqueue(message2);

			const result = queue.dequeue();
			expect(result?.messageId).toBe('msg-1');
			expect(queue.size()).toBe(1);
		});

		it('should maintain FIFO order', () => {
			const messages = ['msg-1', 'msg-2', 'msg-3'].map(createMockMessage);
			messages.forEach((msg) => queue.enqueue(msg));

			expect(queue.dequeue()?.messageId).toBe('msg-1');
			expect(queue.dequeue()?.messageId).toBe('msg-2');
			expect(queue.dequeue()?.messageId).toBe('msg-3');
			expect(queue.dequeue()).toBeNull();
		});

		it('should update queue state correctly', () => {
			queue.enqueue(createMockMessage('msg-1'));
			expect(queue.isEmpty()).toBe(false);

			queue.dequeue();
			expect(queue.isEmpty()).toBe(true);
			expect(queue.size()).toBe(0);
		});
	});

	describe('dequeueBatch', () => {
		beforeEach(() => {
			// Add some messages for batch testing
			for (let i = 1; i <= 4; i++) {
				queue.enqueue(createMockMessage(`msg-${i}`));
			}
		});

		it('should return empty array for invalid batch size', () => {
			expect(queue.dequeueBatch(0)).toEqual([]);
			expect(queue.dequeueBatch(-1)).toEqual([]);
		});

		it('should return requested number of messages', () => {
			const batch = queue.dequeueBatch(2);

			expect(batch).toHaveLength(2);
			expect(batch[0].messageId).toBe('msg-1');
			expect(batch[1].messageId).toBe('msg-2');
			expect(queue.size()).toBe(2);
		});

		it('should return all available messages when batch size exceeds queue size', () => {
			const batch = queue.dequeueBatch(10);

			expect(batch).toHaveLength(4);
			expect(queue.size()).toBe(0);
			expect(queue.isEmpty()).toBe(true);
		});

		it('should maintain FIFO order in batch', () => {
			const batch = queue.dequeueBatch(3);

			expect(batch[0].messageId).toBe('msg-1');
			expect(batch[1].messageId).toBe('msg-2');
			expect(batch[2].messageId).toBe('msg-3');
		});

		it('should return empty array for empty queue', () => {
			queue.clear();
			const batch = queue.dequeueBatch(5);

			expect(batch).toEqual([]);
		});

		it('should work correctly with single message', () => {
			queue.clear();
			queue.enqueue(createMockMessage('single-msg'));

			const batch = queue.dequeueBatch(1);
			expect(batch).toHaveLength(1);
			expect(batch[0].messageId).toBe('single-msg');
		});
	});

	describe('size', () => {
		it('should return 0 for empty queue', () => {
			expect(queue.size()).toBe(0);
		});

		it('should return correct size after adding messages', () => {
			queue.enqueue(createMockMessage('msg-1'));
			expect(queue.size()).toBe(1);

			queue.enqueue(createMockMessage('msg-2'));
			expect(queue.size()).toBe(2);
		});

		it('should return correct size after removing messages', () => {
			queue.enqueue(createMockMessage('msg-1'));
			queue.enqueue(createMockMessage('msg-2'));

			queue.dequeue();
			expect(queue.size()).toBe(1);

			queue.dequeue();
			expect(queue.size()).toBe(0);
		});

		it('should not exceed max size during overflow', () => {
			// Fill beyond capacity
			for (let i = 1; i <= 10; i++) {
				queue.enqueue(createMockMessage(`msg-${i}`));
			}

			expect(queue.size()).toBe(5); // Should not exceed max size
		});
	});

	describe('clear', () => {
		it('should remove all messages from queue', () => {
			queue.enqueue(createMockMessage('msg-1'));
			queue.enqueue(createMockMessage('msg-2'));

			queue.clear();

			expect(queue.size()).toBe(0);
			expect(queue.isEmpty()).toBe(true);
			expect(queue.dequeue()).toBeNull();
		});

		it('should work on empty queue', () => {
			queue.clear();

			expect(queue.size()).toBe(0);
			expect(queue.isEmpty()).toBe(true);
		});
	});

	describe('isEmpty', () => {
		it('should return true for new queue', () => {
			expect(queue.isEmpty()).toBe(true);
		});

		it('should return false when queue has messages', () => {
			queue.enqueue(createMockMessage('msg-1'));
			expect(queue.isEmpty()).toBe(false);
		});

		it('should return true after clearing queue', () => {
			queue.enqueue(createMockMessage('msg-1'));
			queue.clear();
			expect(queue.isEmpty()).toBe(true);
		});

		it('should return true after dequeuing all messages', () => {
			queue.enqueue(createMockMessage('msg-1'));
			queue.dequeue();
			expect(queue.isEmpty()).toBe(true);
		});
	});

	describe('isFull', () => {
		it('should return false for new queue', () => {
			expect(queue.isFull()).toBe(false);
		});

		it('should return false when queue is not at capacity', () => {
			queue.enqueue(createMockMessage('msg-1'));
			expect(queue.isFull()).toBe(false);
		});

		it('should return true when queue is at capacity', () => {
			for (let i = 1; i <= 5; i++) {
				queue.enqueue(createMockMessage(`msg-${i}`));
			}
			expect(queue.isFull()).toBe(true);
		});

		it('should return false after dequeuing from full queue', () => {
			for (let i = 1; i <= 5; i++) {
				queue.enqueue(createMockMessage(`msg-${i}`));
			}
			queue.dequeue();
			expect(queue.isFull()).toBe(false);
		});
	});

	describe('getMaxSize', () => {
		it('should return the configured max size', () => {
			expect(queue.getMaxSize()).toBe(5);

			const largerQueue = new MessageQueue(1000);
			expect(largerQueue.getMaxSize()).toBe(1000);
		});
	});

	describe('overflow scenarios', () => {
		it('should handle continuous overflow correctly', () => {
			// Fill queue to capacity
			for (let i = 1; i <= 5; i++) {
				queue.enqueue(createMockMessage(`msg-${i}`));
			}

			// Add many more messages
			for (let i = 6; i <= 20; i++) {
				const result = queue.enqueue(createMockMessage(`msg-${i}`));
				expect(result).toBe(false); // Should return false for overflow
			}

			// Queue should still be at max capacity
			expect(queue.size()).toBe(5);
			expect(queue.isFull()).toBe(true);

			// Should contain the last 5 messages (16, 17, 18, 19, 20)
			expect(queue.dequeue()?.messageId).toBe('msg-16');
			expect(queue.dequeue()?.messageId).toBe('msg-17');
			expect(queue.dequeue()?.messageId).toBe('msg-18');
			expect(queue.dequeue()?.messageId).toBe('msg-19');
			expect(queue.dequeue()?.messageId).toBe('msg-20');
		});

		it('should handle mixed enqueue/dequeue operations during overflow', () => {
			// Fill queue
			for (let i = 1; i <= 5; i++) {
				queue.enqueue(createMockMessage(`msg-${i}`));
			}

			// Remove one message
			const removed = queue.dequeue();
			expect(removed?.messageId).toBe('msg-1');
			expect(queue.size()).toBe(4);

			// Add new message - should not cause overflow now
			const result = queue.enqueue(createMockMessage('msg-6'));
			expect(result).toBe(true);
			expect(queue.size()).toBe(5);

			// Add another - should cause overflow
			const overflowResult = queue.enqueue(createMockMessage('msg-7'));
			expect(overflowResult).toBe(false);
			expect(queue.size()).toBe(5);

			// Verify correct order: should have 3, 4, 5, 6, 7 (2 was dropped)
			expect(queue.dequeue()?.messageId).toBe('msg-3');
		});

		it('should handle batch operations during overflow conditions', () => {
			// Fill queue
			for (let i = 1; i <= 5; i++) {
				queue.enqueue(createMockMessage(`msg-${i}`));
			}

			// Add more messages causing overflow
			for (let i = 6; i <= 10; i++) {
				queue.enqueue(createMockMessage(`msg-${i}`));
			}

			// Batch dequeue should return messages in correct order
			const batch = queue.dequeueBatch(3);
			expect(batch).toHaveLength(3);
			expect(batch[0].messageId).toBe('msg-6');
			expect(batch[1].messageId).toBe('msg-7');
			expect(batch[2].messageId).toBe('msg-8');

			// Remaining messages should be in correct order
			expect(queue.dequeue()?.messageId).toBe('msg-9');
			expect(queue.dequeue()?.messageId).toBe('msg-10');
		});
	});

	describe('edge cases', () => {
		it('should handle queue with max size of 1', () => {
			const singleQueue = new MessageQueue(1);

			singleQueue.enqueue(createMockMessage('msg-1'));
			expect(singleQueue.size()).toBe(1);
			expect(singleQueue.isFull()).toBe(true);

			// Adding another should replace the first
			const result = singleQueue.enqueue(createMockMessage('msg-2'));
			expect(result).toBe(false);
			expect(singleQueue.size()).toBe(1);

			// Should contain only the second message
			expect(singleQueue.dequeue()?.messageId).toBe('msg-2');
		});

		it('should handle rapid enqueue/dequeue cycles', () => {
			for (let cycle = 0; cycle < 100; cycle++) {
				queue.enqueue(createMockMessage(`cycle-${cycle}`));
				if (cycle % 2 === 0) {
					queue.dequeue();
				}
			}

			// Queue should be in a consistent state
			expect(queue.size()).toBeGreaterThan(0);
			expect(queue.size()).toBeLessThanOrEqual(5);

			// Should be able to dequeue remaining messages
			let dequeueCount = 0;
			while (!queue.isEmpty()) {
				const message = queue.dequeue();
				expect(message).not.toBeNull();
				dequeueCount++;
			}

			expect(dequeueCount).toBe(queue.size() + dequeueCount);
		});
	});
});
