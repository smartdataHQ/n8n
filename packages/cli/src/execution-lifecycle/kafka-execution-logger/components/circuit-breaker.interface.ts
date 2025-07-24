/**
 * Circuit breaker states
 */
export type CircuitBreakerState = 'Closed' | 'Open' | 'Half-Open';

/**
 * Circuit breaker metrics for monitoring
 */
export interface CircuitBreakerMetrics {
	state: CircuitBreakerState;
	failureCount: number;
	successCount: number;
	lastFailureTime?: Date;
	nextAttemptTime?: Date;
}

/**
 * Interface for circuit breaker to prevent cascading failures
 */
export interface ICircuitBreaker {
	/**
	 * Execute an operation through the circuit breaker
	 * @param operation The async operation to execute
	 * @returns Promise that resolves to the operation result
	 * @throws Error if circuit is open or operation fails
	 */
	execute<T>(operation: () => Promise<T>): Promise<T>;

	/**
	 * Get the current state of the circuit breaker
	 * @returns Current circuit breaker state
	 */
	getState(): CircuitBreakerState;

	/**
	 * Get metrics for monitoring the circuit breaker
	 * @returns Current circuit breaker metrics
	 */
	getMetrics(): CircuitBreakerMetrics;
}
