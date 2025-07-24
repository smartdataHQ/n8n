import { HealthMetrics } from '../components/health-metrics';
import type { CircuitBreakerState } from '../components/circuit-breaker.interface';

describe('HealthMetrics', () => {
	let healthMetrics: HealthMetrics;

	beforeEach(() => {
		healthMetrics = new HealthMetrics();
	});

	describe('constructor', () => {
		it('should initialize with default values', () => {
			const metrics = healthMetrics.getMetrics();

			expect(metrics.successCount).toBe(0);
			expect(metrics.failureCount).toBe(0);
			expect(metrics.queueDepth).toBe(0);
			expect(metrics.circuitBreakerState).toBe('Closed');
			expect(metrics.lastSuccessTime).toBeUndefined();
			expect(metrics.lastFailureTime).toBeUndefined();
			expect(metrics.uptime).toBeGreaterThanOrEqual(0);
		});

		it('should set start time correctly', () => {
			const beforeCreation = Date.now();
			const newHealthMetrics = new HealthMetrics();
			const afterCreation = Date.now();

			const metrics = newHealthMetrics.getMetrics();
			const startTime = afterCreation - metrics.uptime;

			expect(startTime).toBeGreaterThanOrEqual(beforeCreation);
			expect(startTime).toBeLessThanOrEqual(afterCreation);
		});
	});

	describe('incrementSuccess', () => {
		it('should increment success count', () => {
			healthMetrics.incrementSuccess();

			const metrics = healthMetrics.getMetrics();
			expect(metrics.successCount).toBe(1);
		});

		it('should update last success time', () => {
			const beforeIncrement = new Date();
			healthMetrics.incrementSuccess();
			const afterIncrement = new Date();

			const metrics = healthMetrics.getMetrics();
			expect(metrics.lastSuccessTime).toBeDefined();
			expect(metrics.lastSuccessTime!.getTime()).toBeGreaterThanOrEqual(beforeIncrement.getTime());
			expect(metrics.lastSuccessTime!.getTime()).toBeLessThanOrEqual(afterIncrement.getTime());
		});

		it('should increment multiple times correctly', () => {
			healthMetrics.incrementSuccess();
			healthMetrics.incrementSuccess();
			healthMetrics.incrementSuccess();

			const metrics = healthMetrics.getMetrics();
			expect(metrics.successCount).toBe(3);
		});

		it('should update last success time on each increment', async () => {
			healthMetrics.incrementSuccess();
			const firstSuccessTime = healthMetrics.getMetrics().lastSuccessTime!;

			// Wait a small amount to ensure different timestamps
			await new Promise((resolve) => setTimeout(resolve, 5));

			healthMetrics.incrementSuccess();
			const secondSuccessTime = healthMetrics.getMetrics().lastSuccessTime!;

			expect(secondSuccessTime.getTime()).toBeGreaterThanOrEqual(firstSuccessTime.getTime());
		});
	});

	describe('incrementFailure', () => {
		it('should increment failure count', () => {
			healthMetrics.incrementFailure();

			const metrics = healthMetrics.getMetrics();
			expect(metrics.failureCount).toBe(1);
		});

		it('should update last failure time', () => {
			const beforeIncrement = new Date();
			healthMetrics.incrementFailure();
			const afterIncrement = new Date();

			const metrics = healthMetrics.getMetrics();
			expect(metrics.lastFailureTime).toBeDefined();
			expect(metrics.lastFailureTime!.getTime()).toBeGreaterThanOrEqual(beforeIncrement.getTime());
			expect(metrics.lastFailureTime!.getTime()).toBeLessThanOrEqual(afterIncrement.getTime());
		});

		it('should increment multiple times correctly', () => {
			healthMetrics.incrementFailure();
			healthMetrics.incrementFailure();
			healthMetrics.incrementFailure();

			const metrics = healthMetrics.getMetrics();
			expect(metrics.failureCount).toBe(3);
		});

		it('should update last failure time on each increment', async () => {
			healthMetrics.incrementFailure();
			const firstFailureTime = healthMetrics.getMetrics().lastFailureTime!;

			// Wait a small amount to ensure different timestamps
			await new Promise((resolve) => setTimeout(resolve, 10));

			healthMetrics.incrementFailure();
			const secondFailureTime = healthMetrics.getMetrics().lastFailureTime!;

			expect(secondFailureTime.getTime()).toBeGreaterThanOrEqual(firstFailureTime.getTime());
		});
	});

	describe('setQueueDepth', () => {
		it('should set queue depth correctly', () => {
			healthMetrics.setQueueDepth(42);

			const metrics = healthMetrics.getMetrics();
			expect(metrics.queueDepth).toBe(42);
		});

		it('should allow zero queue depth', () => {
			healthMetrics.setQueueDepth(0);

			const metrics = healthMetrics.getMetrics();
			expect(metrics.queueDepth).toBe(0);
		});

		it('should throw error for negative queue depth', () => {
			expect(() => healthMetrics.setQueueDepth(-1)).toThrow('Queue depth cannot be negative');
		});

		it('should update queue depth multiple times', () => {
			healthMetrics.setQueueDepth(10);
			expect(healthMetrics.getMetrics().queueDepth).toBe(10);

			healthMetrics.setQueueDepth(20);
			expect(healthMetrics.getMetrics().queueDepth).toBe(20);

			healthMetrics.setQueueDepth(0);
			expect(healthMetrics.getMetrics().queueDepth).toBe(0);
		});
	});

	describe('setCircuitBreakerState', () => {
		it('should set circuit breaker state to Open', () => {
			healthMetrics.setCircuitBreakerState('Open');

			const metrics = healthMetrics.getMetrics();
			expect(metrics.circuitBreakerState).toBe('Open');
		});

		it('should set circuit breaker state to Half-Open', () => {
			healthMetrics.setCircuitBreakerState('Half-Open');

			const metrics = healthMetrics.getMetrics();
			expect(metrics.circuitBreakerState).toBe('Half-Open');
		});

		it('should set circuit breaker state to Closed', () => {
			healthMetrics.setCircuitBreakerState('Closed');

			const metrics = healthMetrics.getMetrics();
			expect(metrics.circuitBreakerState).toBe('Closed');
		});

		it('should update circuit breaker state multiple times', () => {
			const states: CircuitBreakerState[] = ['Open', 'Half-Open', 'Closed'];

			states.forEach((state) => {
				healthMetrics.setCircuitBreakerState(state);
				expect(healthMetrics.getMetrics().circuitBreakerState).toBe(state);
			});
		});
	});

	describe('getMetrics', () => {
		it('should return a complete metrics snapshot', () => {
			healthMetrics.incrementSuccess();
			healthMetrics.incrementFailure();
			healthMetrics.setQueueDepth(5);
			healthMetrics.setCircuitBreakerState('Open');

			const metrics = healthMetrics.getMetrics();

			expect(metrics.successCount).toBe(1);
			expect(metrics.failureCount).toBe(1);
			expect(metrics.queueDepth).toBe(5);
			expect(metrics.circuitBreakerState).toBe('Open');
			expect(metrics.lastSuccessTime).toBeDefined();
			expect(metrics.lastFailureTime).toBeDefined();
			expect(metrics.uptime).toBeGreaterThanOrEqual(0);
		});

		it('should return independent snapshots', () => {
			const snapshot1 = healthMetrics.getMetrics();
			const snapshot2 = healthMetrics.getMetrics();

			expect(snapshot1).not.toBe(snapshot2);
			expect(snapshot1).toEqual(snapshot2);
		});

		it('should return cloned date objects', () => {
			healthMetrics.incrementSuccess();
			healthMetrics.incrementFailure();

			const metrics = healthMetrics.getMetrics();
			const originalSuccessTime = metrics.lastSuccessTime!;
			const originalFailureTime = metrics.lastFailureTime!;

			// Modify the returned dates
			originalSuccessTime.setTime(0);
			originalFailureTime.setTime(0);

			// Get new snapshot and verify dates weren't affected
			const newMetrics = healthMetrics.getMetrics();
			expect(newMetrics.lastSuccessTime!.getTime()).not.toBe(0);
			expect(newMetrics.lastFailureTime!.getTime()).not.toBe(0);
		});

		it('should calculate uptime correctly', async () => {
			const initialMetrics = healthMetrics.getMetrics();
			const initialUptime = initialMetrics.uptime;

			// Wait a small amount
			await new Promise((resolve) => setTimeout(resolve, 10));

			const laterMetrics = healthMetrics.getMetrics();
			const laterUptime = laterMetrics.uptime;

			expect(laterUptime).toBeGreaterThan(initialUptime);
			expect(laterUptime - initialUptime).toBeGreaterThanOrEqual(10);
		});
	});

	describe('reset', () => {
		it('should reset all counters and states', () => {
			// Set up some data
			healthMetrics.incrementSuccess();
			healthMetrics.incrementFailure();
			healthMetrics.setQueueDepth(10);
			healthMetrics.setCircuitBreakerState('Open');

			// Reset
			healthMetrics.reset();

			// Verify reset
			const metrics = healthMetrics.getMetrics();
			expect(metrics.successCount).toBe(0);
			expect(metrics.failureCount).toBe(0);
			expect(metrics.queueDepth).toBe(0);
			expect(metrics.circuitBreakerState).toBe('Closed');
			expect(metrics.lastSuccessTime).toBeUndefined();
			expect(metrics.lastFailureTime).toBeUndefined();
		});

		it('should not reset uptime', () => {
			const beforeReset = healthMetrics.getMetrics().uptime;
			healthMetrics.reset();
			const afterReset = healthMetrics.getMetrics().uptime;

			expect(afterReset).toBeGreaterThanOrEqual(beforeReset);
		});
	});

	describe('getSuccessRate', () => {
		it('should return null when no operations recorded', () => {
			expect(healthMetrics.getSuccessRate()).toBeNull();
		});

		it('should return 100% for all successes', () => {
			healthMetrics.incrementSuccess();
			healthMetrics.incrementSuccess();

			expect(healthMetrics.getSuccessRate()).toBe(100);
		});

		it('should return 0% for all failures', () => {
			healthMetrics.incrementFailure();
			healthMetrics.incrementFailure();

			expect(healthMetrics.getSuccessRate()).toBe(0);
		});

		it('should calculate mixed success rate correctly', () => {
			healthMetrics.incrementSuccess();
			healthMetrics.incrementSuccess();
			healthMetrics.incrementFailure();
			healthMetrics.incrementFailure();

			expect(healthMetrics.getSuccessRate()).toBe(50);
		});

		it('should calculate fractional success rate correctly', () => {
			healthMetrics.incrementSuccess();
			healthMetrics.incrementFailure();
			healthMetrics.incrementFailure();

			expect(healthMetrics.getSuccessRate()).toBeCloseTo(33.33, 2);
		});
	});

	describe('getTotalOperations', () => {
		it('should return 0 when no operations recorded', () => {
			expect(healthMetrics.getTotalOperations()).toBe(0);
		});

		it('should count only successes', () => {
			healthMetrics.incrementSuccess();
			healthMetrics.incrementSuccess();

			expect(healthMetrics.getTotalOperations()).toBe(2);
		});

		it('should count only failures', () => {
			healthMetrics.incrementFailure();
			healthMetrics.incrementFailure();

			expect(healthMetrics.getTotalOperations()).toBe(2);
		});

		it('should count mixed operations', () => {
			healthMetrics.incrementSuccess();
			healthMetrics.incrementFailure();
			healthMetrics.incrementSuccess();
			healthMetrics.incrementFailure();
			healthMetrics.incrementFailure();

			expect(healthMetrics.getTotalOperations()).toBe(5);
		});
	});

	describe('thread safety considerations', () => {
		it('should handle rapid successive operations', () => {
			// Simulate rapid operations
			for (let i = 0; i < 1000; i++) {
				if (i % 2 === 0) {
					healthMetrics.incrementSuccess();
				} else {
					healthMetrics.incrementFailure();
				}
				healthMetrics.setQueueDepth(i % 100);
			}

			const metrics = healthMetrics.getMetrics();
			expect(metrics.successCount).toBe(500);
			expect(metrics.failureCount).toBe(500);
			expect(metrics.queueDepth).toBe(99); // (999 % 100)
		});
	});

	describe('edge cases', () => {
		it('should handle very large counters', () => {
			const largeNumber = Number.MAX_SAFE_INTEGER - 1;

			// Manually set counters to large values
			for (let i = 0; i < largeNumber && i < 1000; i++) {
				healthMetrics.incrementSuccess();
			}

			expect(healthMetrics.getMetrics().successCount).toBe(1000);
		});

		it('should handle queue depth at boundaries', () => {
			healthMetrics.setQueueDepth(Number.MAX_SAFE_INTEGER);
			expect(healthMetrics.getMetrics().queueDepth).toBe(Number.MAX_SAFE_INTEGER);

			healthMetrics.setQueueDepth(0);
			expect(healthMetrics.getMetrics().queueDepth).toBe(0);
		});
	});
});
