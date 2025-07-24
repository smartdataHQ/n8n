import type { IHealthMetrics, HealthMetricsSnapshot } from './health-metrics.interface';
import type { CircuitBreakerState } from './circuit-breaker.interface';

/**
 * Health metrics component for tracking operational statistics
 * Provides thread-safe metrics collection and reporting
 */
export class HealthMetrics implements IHealthMetrics {
	private successCount = 0;
	private failureCount = 0;
	private queueDepth = 0;
	private circuitBreakerState: CircuitBreakerState = 'Closed';
	private lastSuccessTime?: Date;
	private lastFailureTime?: Date;
	private readonly startTime: Date;

	constructor() {
		this.startTime = new Date();
	}

	/**
	 * Increment the success counter and update last success time
	 */
	incrementSuccess(): void {
		this.successCount++;
		this.lastSuccessTime = new Date();
	}

	/**
	 * Increment the failure counter and update last failure time
	 */
	incrementFailure(): void {
		this.failureCount++;
		this.lastFailureTime = new Date();
	}

	/**
	 * Update the current queue depth
	 * @param depth Current number of messages in queue
	 */
	setQueueDepth(depth: number): void {
		if (depth < 0) {
			throw new Error('Queue depth cannot be negative');
		}
		this.queueDepth = depth;
	}

	/**
	 * Update the circuit breaker state
	 * @param state Current circuit breaker state
	 */
	setCircuitBreakerState(state: CircuitBreakerState): void {
		this.circuitBreakerState = state;
	}

	/**
	 * Get a snapshot of all current metrics
	 * @returns Current metrics snapshot
	 */
	getMetrics(): HealthMetricsSnapshot {
		const now = new Date();
		const uptime = now.getTime() - this.startTime.getTime();

		return {
			successCount: this.successCount,
			failureCount: this.failureCount,
			queueDepth: this.queueDepth,
			circuitBreakerState: this.circuitBreakerState,
			lastSuccessTime: this.lastSuccessTime ? new Date(this.lastSuccessTime) : undefined,
			lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime) : undefined,
			uptime,
		};
	}

	/**
	 * Reset all counters (useful for testing)
	 */
	reset(): void {
		this.successCount = 0;
		this.failureCount = 0;
		this.queueDepth = 0;
		this.circuitBreakerState = 'Closed';
		this.lastSuccessTime = undefined;
		this.lastFailureTime = undefined;
	}

	/**
	 * Get success rate as a percentage
	 * @returns Success rate (0-100) or null if no operations recorded
	 */
	getSuccessRate(): number | null {
		const total = this.successCount + this.failureCount;
		if (total === 0) {
			return null;
		}
		return (this.successCount / total) * 100;
	}

	/**
	 * Get total operation count
	 * @returns Total number of operations (success + failure)
	 */
	getTotalOperations(): number {
		return this.successCount + this.failureCount;
	}
}
