import type { CircuitBreakerState } from './circuit-breaker.interface';

/**
 * Health metrics snapshot for monitoring
 */
export interface HealthMetricsSnapshot {
	successCount: number;
	failureCount: number;
	queueDepth: number;
	circuitBreakerState: CircuitBreakerState;
	lastSuccessTime?: Date;
	lastFailureTime?: Date;
	uptime: number; // milliseconds since service started
}

/**
 * Interface for tracking and exposing operational metrics
 */
export interface IHealthMetrics {
	/**
	 * Increment the success counter
	 */
	incrementSuccess(): void;

	/**
	 * Increment the failure counter
	 */
	incrementFailure(): void;

	/**
	 * Update the current queue depth
	 * @param depth Current number of messages in queue
	 */
	setQueueDepth(depth: number): void;

	/**
	 * Update the circuit breaker state
	 * @param state Current circuit breaker state
	 */
	setCircuitBreakerState(state: CircuitBreakerState): void;

	/**
	 * Get a snapshot of all current metrics
	 * @returns Current metrics snapshot
	 */
	getMetrics(): HealthMetricsSnapshot;
}
