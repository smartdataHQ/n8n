import type {
	ICircuitBreaker,
	CircuitBreakerState,
	CircuitBreakerMetrics,
} from './circuit-breaker.interface';

/**
 * Configuration for the circuit breaker
 */
export interface CircuitBreakerConfig {
	failureThreshold: number;
	resetTimeout: number;
	monitoringPeriod: number;
}

/**
 * Circuit breaker implementation to prevent cascading failures
 *
 * States:
 * - Closed: Normal operation, requests pass through
 * - Open: Circuit is open, requests fail fast
 * - Half-Open: Testing if service has recovered
 */
export class CircuitBreaker implements ICircuitBreaker {
	private state: CircuitBreakerState = 'Closed';
	private failureCount = 0;
	private successCount = 0;
	private lastFailureTime?: Date;
	private nextAttemptTime?: Date;
	private monitoringWindowStart = Date.now();
	private readonly config: CircuitBreakerConfig;

	constructor(config: CircuitBreakerConfig);
	constructor(
		failureThreshold: number,
		resetTimeout: number,
		monitoringPeriod: number,
		logger?: any,
	);
	constructor(
		configOrFailureThreshold: CircuitBreakerConfig | number,
		resetTimeout?: number,
		monitoringPeriod?: number,
		logger?: any,
	) {
		// Support both constructor signatures for backward compatibility
		if (typeof configOrFailureThreshold === 'object') {
			this.config = configOrFailureThreshold;
		} else {
			this.config = {
				failureThreshold: configOrFailureThreshold,
				resetTimeout: resetTimeout!,
				monitoringPeriod: monitoringPeriod!,
			};
		}

		if (this.config.failureThreshold <= 0) {
			throw new Error('Failure threshold must be greater than 0');
		}
		if (this.config.resetTimeout <= 0) {
			throw new Error('Reset timeout must be greater than 0');
		}
		if (this.config.monitoringPeriod <= 0) {
			throw new Error('Monitoring period must be greater than 0');
		}
	}

	/**
	 * Execute an operation through the circuit breaker
	 */
	async execute<T>(operation: () => Promise<T>): Promise<T> {
		this.checkMonitoringWindow();

		if (this.state === 'Open') {
			if (this.shouldAttemptReset()) {
				this.state = 'Half-Open';
			} else {
				throw new Error('Circuit breaker is open');
			}
		}

		try {
			const result = await operation();
			this.onSuccess();
			return result;
		} catch (error) {
			this.onFailure();
			throw error;
		}
	}

	/**
	 * Get the current state of the circuit breaker
	 */
	getState(): CircuitBreakerState {
		this.checkMonitoringWindow();
		return this.state;
	}

	/**
	 * Get metrics for monitoring the circuit breaker
	 */
	getMetrics(): CircuitBreakerMetrics {
		this.checkMonitoringWindow();
		return {
			state: this.state,
			failureCount: this.failureCount,
			successCount: this.successCount,
			lastFailureTime: this.lastFailureTime,
			nextAttemptTime: this.nextAttemptTime,
		};
	}

	/**
	 * Handle successful operation
	 */
	private onSuccess(): void {
		this.successCount++;

		if (this.state === 'Half-Open') {
			// Reset to closed state after successful operation in half-open state
			this.state = 'Closed';
			this.failureCount = 0;
			this.nextAttemptTime = undefined;
		}
	}

	/**
	 * Handle failed operation
	 */
	private onFailure(): void {
		this.failureCount++;
		this.lastFailureTime = new Date();

		if (this.state === 'Half-Open') {
			// Go back to open state if operation fails in half-open state
			this.state = 'Open';
			this.setNextAttemptTime();
		} else if (this.state === 'Closed' && this.failureCount >= this.config.failureThreshold) {
			// Open the circuit if failure threshold is reached
			this.state = 'Open';
			this.setNextAttemptTime();
		}
	}

	/**
	 * Check if we should attempt to reset the circuit breaker
	 */
	private shouldAttemptReset(): boolean {
		if (!this.nextAttemptTime) {
			return true;
		}
		return Date.now() >= this.nextAttemptTime.getTime();
	}

	/**
	 * Set the next attempt time using exponential backoff
	 */
	private setNextAttemptTime(): void {
		// Calculate exponential backoff based on failure count
		// Base timeout * 2^(failureCount - threshold)
		const backoffMultiplier = Math.pow(
			2,
			Math.max(0, this.failureCount - this.config.failureThreshold),
		);
		const backoffTime = this.config.resetTimeout * Math.min(backoffMultiplier, 8); // Cap at 8x

		this.nextAttemptTime = new Date(Date.now() + backoffTime);
	}

	/**
	 * Check if we need to reset the monitoring window
	 */
	private checkMonitoringWindow(): void {
		const now = Date.now();
		if (now - this.monitoringWindowStart >= this.config.monitoringPeriod) {
			// Reset counters for new monitoring period
			this.monitoringWindowStart = now;

			// Only reset counters if circuit is closed (normal operation)
			if (this.state === 'Closed') {
				this.failureCount = 0;
				this.successCount = 0;
			}
		}
	}
}
