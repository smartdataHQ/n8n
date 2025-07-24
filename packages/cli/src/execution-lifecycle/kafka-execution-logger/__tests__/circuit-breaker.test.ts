import { CircuitBreaker, type CircuitBreakerConfig } from '../components/circuit-breaker';
import type { CircuitBreakerState } from '../components/circuit-breaker.interface';

describe('CircuitBreaker', () => {
	let circuitBreaker: CircuitBreaker;
	let config: CircuitBreakerConfig;

	beforeEach(() => {
		config = {
			failureThreshold: 3,
			resetTimeout: 1000,
			monitoringPeriod: 5000,
		};
		circuitBreaker = new CircuitBreaker(config);
	});

	describe('constructor', () => {
		it('should create circuit breaker with valid config', () => {
			expect(circuitBreaker.getState()).toBe('Closed');
			expect(circuitBreaker.getMetrics().failureCount).toBe(0);
			expect(circuitBreaker.getMetrics().successCount).toBe(0);
		});

		it('should throw error for invalid failure threshold', () => {
			expect(() => new CircuitBreaker({ ...config, failureThreshold: 0 })).toThrow(
				'Failure threshold must be greater than 0',
			);
			expect(() => new CircuitBreaker({ ...config, failureThreshold: -1 })).toThrow(
				'Failure threshold must be greater than 0',
			);
		});

		it('should throw error for invalid reset timeout', () => {
			expect(() => new CircuitBreaker({ ...config, resetTimeout: 0 })).toThrow(
				'Reset timeout must be greater than 0',
			);
			expect(() => new CircuitBreaker({ ...config, resetTimeout: -1 })).toThrow(
				'Reset timeout must be greater than 0',
			);
		});

		it('should throw error for invalid monitoring period', () => {
			expect(() => new CircuitBreaker({ ...config, monitoringPeriod: 0 })).toThrow(
				'Monitoring period must be greater than 0',
			);
			expect(() => new CircuitBreaker({ ...config, monitoringPeriod: -1 })).toThrow(
				'Monitoring period must be greater than 0',
			);
		});
	});

	describe('execute - Closed state', () => {
		it('should execute operation successfully when closed', async () => {
			const operation = jest.fn().mockResolvedValue('success');

			const result = await circuitBreaker.execute(operation);

			expect(result).toBe('success');
			expect(operation).toHaveBeenCalledTimes(1);
			expect(circuitBreaker.getState()).toBe('Closed');
			expect(circuitBreaker.getMetrics().successCount).toBe(1);
		});

		it('should handle operation failure when closed', async () => {
			const error = new Error('Operation failed');
			const operation = jest.fn().mockRejectedValue(error);

			await expect(circuitBreaker.execute(operation)).rejects.toThrow('Operation failed');
			expect(circuitBreaker.getState()).toBe('Closed');
			expect(circuitBreaker.getMetrics().failureCount).toBe(1);
		});

		it('should transition to Open state after reaching failure threshold', async () => {
			const operation = jest.fn().mockRejectedValue(new Error('Failed'));

			// Execute failures up to threshold
			for (let i = 0; i < config.failureThreshold; i++) {
				await expect(circuitBreaker.execute(operation)).rejects.toThrow();
			}

			expect(circuitBreaker.getState()).toBe('Open');
			expect(circuitBreaker.getMetrics().failureCount).toBe(config.failureThreshold);
		});
	});

	describe('execute - Open state', () => {
		beforeEach(async () => {
			// Force circuit to open state
			const failingOperation = jest.fn().mockRejectedValue(new Error('Failed'));
			for (let i = 0; i < config.failureThreshold; i++) {
				await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow();
			}
			expect(circuitBreaker.getState()).toBe('Open');
		});

		it('should fail fast when circuit is open', async () => {
			const operation = jest.fn().mockResolvedValue('success');

			await expect(circuitBreaker.execute(operation)).rejects.toThrow('Circuit breaker is open');
			expect(operation).not.toHaveBeenCalled();
		});

		it('should transition to Half-Open after reset timeout', async () => {
			const operation = jest.fn().mockResolvedValue('success');

			// Wait for reset timeout
			await new Promise((resolve) => setTimeout(resolve, config.resetTimeout + 100));

			const result = await circuitBreaker.execute(operation);

			expect(result).toBe('success');
			expect(circuitBreaker.getState()).toBe('Closed');
		});
	});

	describe('execute - Half-Open state', () => {
		beforeEach(async () => {
			// Force circuit to open state
			const failingOperation = jest.fn().mockRejectedValue(new Error('Failed'));
			for (let i = 0; i < config.failureThreshold; i++) {
				await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow();
			}
			// Wait for reset timeout to allow transition to half-open
			await new Promise((resolve) => setTimeout(resolve, config.resetTimeout + 100));
		});

		it('should transition to Closed on successful operation', async () => {
			const operation = jest.fn().mockResolvedValue('success');

			const result = await circuitBreaker.execute(operation);

			expect(result).toBe('success');
			expect(circuitBreaker.getState()).toBe('Closed');
			expect(circuitBreaker.getMetrics().failureCount).toBe(0);
		});

		it('should transition back to Open on failed operation', async () => {
			const operation = jest.fn().mockRejectedValue(new Error('Still failing'));

			await expect(circuitBreaker.execute(operation)).rejects.toThrow('Still failing');
			expect(circuitBreaker.getState()).toBe('Open');
		});
	});

	describe('exponential backoff', () => {
		it('should implement exponential backoff for reset timeout', async () => {
			const failingOperation = jest.fn().mockRejectedValue(new Error('Failed'));

			// Cause failures beyond threshold to trigger exponential backoff
			// The backoff is calculated based on total failure count vs threshold
			for (let i = 0; i < config.failureThreshold + 2; i++) {
				await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow();
			}

			expect(circuitBreaker.getState()).toBe('Open');
			const metrics = circuitBreaker.getMetrics();
			expect(metrics.nextAttemptTime).toBeDefined();

			// With 5 failures and threshold of 3: 2^(5-3) = 4, so 4x the base timeout
			// The next attempt time should be at least 4x the base timeout from when it was set
			const now = Date.now();
			const baseTimeout = config.resetTimeout;
			const expectedMultiplier = Math.pow(2, metrics.failureCount - config.failureThreshold);
			const expectedBackoffTime = baseTimeout * Math.min(expectedMultiplier, 8);

			// Allow for some timing variance in test execution
			const minExpectedTime = now + expectedBackoffTime - 1000;
			expect(metrics.nextAttemptTime!.getTime()).toBeGreaterThan(minExpectedTime);
		});

		it('should cap exponential backoff at 8x', async () => {
			const failingOperation = jest.fn().mockRejectedValue(new Error('Failed'));

			// Cause many failures to test backoff cap
			for (let i = 0; i < config.failureThreshold + 10; i++) {
				await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow();
			}

			const metrics = circuitBreaker.getMetrics();
			const maxExpectedTime = Date.now() + config.resetTimeout * 8 + 100; // 8x cap + buffer
			expect(metrics.nextAttemptTime!.getTime()).toBeLessThan(maxExpectedTime);
		});
	});

	describe('monitoring window', () => {
		it('should reset counters after monitoring period in Closed state', async () => {
			const successOperation = jest.fn().mockResolvedValue('success');
			const failOperation = jest.fn().mockRejectedValue(new Error('Failed'));

			// Add some successes and failures
			await circuitBreaker.execute(successOperation);
			await expect(circuitBreaker.execute(failOperation)).rejects.toThrow();

			expect(circuitBreaker.getMetrics().successCount).toBe(1);
			expect(circuitBreaker.getMetrics().failureCount).toBe(1);

			// Mock time passage beyond monitoring period
			jest.spyOn(Date, 'now').mockReturnValue(Date.now() + config.monitoringPeriod + 1000);

			// Trigger monitoring window check
			circuitBreaker.getState();

			expect(circuitBreaker.getMetrics().successCount).toBe(0);
			expect(circuitBreaker.getMetrics().failureCount).toBe(0);

			jest.restoreAllMocks();
		});

		it('should not reset counters in Open state during monitoring window', async () => {
			const failingOperation = jest.fn().mockRejectedValue(new Error('Failed'));

			// Force circuit to open
			for (let i = 0; i < config.failureThreshold; i++) {
				await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow();
			}

			const failureCount = circuitBreaker.getMetrics().failureCount;

			// Mock time passage beyond monitoring period
			jest.spyOn(Date, 'now').mockReturnValue(Date.now() + config.monitoringPeriod + 1000);

			// Trigger monitoring window check
			circuitBreaker.getState();

			// Counters should not reset in Open state
			expect(circuitBreaker.getMetrics().failureCount).toBe(failureCount);

			jest.restoreAllMocks();
		});
	});

	describe('getMetrics', () => {
		it('should return accurate metrics', async () => {
			const successOperation = jest.fn().mockResolvedValue('success');
			const failOperation = jest.fn().mockRejectedValue(new Error('Failed'));

			await circuitBreaker.execute(successOperation);
			await expect(circuitBreaker.execute(failOperation)).rejects.toThrow();

			const metrics = circuitBreaker.getMetrics();

			expect(metrics.state).toBe('Closed');
			expect(metrics.successCount).toBe(1);
			expect(metrics.failureCount).toBe(1);
			expect(metrics.lastFailureTime).toBeInstanceOf(Date);
			expect(metrics.nextAttemptTime).toBeUndefined();
		});

		it('should include nextAttemptTime when circuit is open', async () => {
			const failingOperation = jest.fn().mockRejectedValue(new Error('Failed'));

			// Force circuit to open
			for (let i = 0; i < config.failureThreshold; i++) {
				await expect(circuitBreaker.execute(failingOperation)).rejects.toThrow();
			}

			const metrics = circuitBreaker.getMetrics();

			expect(metrics.state).toBe('Open');
			expect(metrics.nextAttemptTime).toBeInstanceOf(Date);
			expect(metrics.nextAttemptTime!.getTime()).toBeGreaterThan(Date.now());
		});
	});

	describe('state transitions', () => {
		const testStateTransition = async (
			initialState: CircuitBreakerState,
			operation: () => Promise<any>,
			expectedState: CircuitBreakerState,
		) => {
			// Setup initial state if needed
			if (initialState === 'Open') {
				const failingOp = jest.fn().mockRejectedValue(new Error('Failed'));
				for (let i = 0; i < config.failureThreshold; i++) {
					await expect(circuitBreaker.execute(failingOp)).rejects.toThrow();
				}
				// Wait for reset timeout to allow transition to half-open
				await new Promise((resolve) => setTimeout(resolve, config.resetTimeout + 100));
			}

			if (initialState === 'Half-Open') {
				// First get to Open state
				const failingOp = jest.fn().mockRejectedValue(new Error('Failed'));
				for (let i = 0; i < config.failureThreshold; i++) {
					await expect(circuitBreaker.execute(failingOp)).rejects.toThrow();
				}
				// Wait for reset timeout
				await new Promise((resolve) => setTimeout(resolve, config.resetTimeout + 100));
			}

			// For Open state, we need to trigger the transition by attempting an operation
			if (initialState === 'Open') {
				// The state should still be Open until we try to execute
				expect(circuitBreaker.getState()).toBe('Open');
			} else {
				expect(circuitBreaker.getState()).toBe(initialState);
			}

			try {
				await circuitBreaker.execute(operation);
			} catch {
				// Expected for some test cases
			}

			expect(circuitBreaker.getState()).toBe(expectedState);
		};

		it('should transition Closed -> Open on threshold failures', async () => {
			for (let i = 0; i < config.failureThreshold - 1; i++) {
				await expect(
					circuitBreaker.execute(async () => {
						throw new Error('Failed');
					}),
				).rejects.toThrow();
				expect(circuitBreaker.getState()).toBe('Closed');
			}

			await expect(
				circuitBreaker.execute(async () => {
					throw new Error('Failed');
				}),
			).rejects.toThrow();
			expect(circuitBreaker.getState()).toBe('Open');
		});

		it('should transition Open -> Half-Open -> Closed on success', async () => {
			// Force circuit to open
			const failingOp = jest.fn().mockRejectedValue(new Error('Failed'));
			for (let i = 0; i < config.failureThreshold; i++) {
				await expect(circuitBreaker.execute(failingOp)).rejects.toThrow();
			}
			expect(circuitBreaker.getState()).toBe('Open');

			// Wait for reset timeout
			await new Promise((resolve) => setTimeout(resolve, config.resetTimeout + 100));

			// Execute successful operation - should transition Open -> Half-Open -> Closed
			const successOp = jest.fn().mockResolvedValue('success');
			const result = await circuitBreaker.execute(successOp);

			expect(result).toBe('success');
			expect(circuitBreaker.getState()).toBe('Closed');
		});

		it('should transition Open -> Half-Open -> Open on failure', async () => {
			await testStateTransition(
				'Open',
				async () => {
					throw new Error('Still failing');
				},
				'Open',
			);
		});
	});
});
