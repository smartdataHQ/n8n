import type { Logger } from '@n8n/backend-common';
import {
	writeFileSync,
	appendFileSync,
	existsSync,
	mkdirSync,
	statSync,
	unlinkSync,
	renameSync,
} from 'fs';
import { join } from 'path';

import type { ExecutionLogMessage } from '../models';

/**
 * Error categories for Kafka execution logger
 */
export const enum ErrorCategory {
	configuration = 'CONFIGURATION',
	connection = 'CONNECTION',
	authentication = 'AUTHENTICATION',
	messageSending = 'MESSAGE_SENDING',
	serialization = 'SERIALIZATION',
	queueOverflow = 'QUEUE_OVERFLOW',
	timeout = 'TIMEOUT',
	circuitBreaker = 'CIRCUIT_BREAKER',
	unknown = 'UNKNOWN',
}

/**
 * Error severity levels
 */
export const enum ErrorSeverity {
	low = 'LOW',
	medium = 'MEDIUM',
	high = 'HIGH',
	critical = 'CRITICAL',
}

/**
 * Categorized error information
 */
export interface CategorizedError {
	category: ErrorCategory;
	severity: ErrorSeverity;
	message: string;
	originalError: Error;
	context?: Record<string, unknown>;
	shouldRetry: boolean;
	shouldFallback: boolean;
}

/**
 * Local fallback logger configuration
 */
export interface FallbackLoggerConfig {
	enabled: boolean;
	logDirectory: string;
	maxFileSize: number; // in bytes
	maxFiles: number;
	rotateOnStartup: boolean;
}

/**
 * Comprehensive error handler for Kafka execution logger
 * Provides error categorization, local fallback logging, and recovery strategies
 */
export class ErrorHandler {
	private fallbackLogPath: string;
	private currentLogFile: string;

	constructor(
		private readonly logger: Logger,
		private readonly fallbackConfig: FallbackLoggerConfig,
	) {
		this.fallbackLogPath = fallbackConfig.logDirectory;
		this.currentLogFile = join(this.fallbackLogPath, 'kafka-fallback-0.log');

		if (fallbackConfig.enabled) {
			this.initializeFallbackLogging();
		}
	}

	/**
	 * Categorize an error and determine appropriate response strategy
	 */
	categorizeError(error: Error, context?: Record<string, unknown>): CategorizedError {
		const errorMessage = error.message.toLowerCase();

		// Configuration errors
		if (this.isConfigurationError(errorMessage)) {
			return {
				category: ErrorCategory.configuration,
				severity: ErrorSeverity.critical,
				message: 'Configuration error detected',
				originalError: error,
				context,
				shouldRetry: false,
				shouldFallback: true,
			};
		}

		// Authentication errors
		if (this.isAuthenticationError(errorMessage)) {
			return {
				category: ErrorCategory.authentication,
				severity: ErrorSeverity.high,
				message: 'Authentication failed',
				originalError: error,
				context,
				shouldRetry: false,
				shouldFallback: true,
			};
		}

		// Connection errors
		if (this.isConnectionError(errorMessage)) {
			return {
				category: ErrorCategory.connection,
				severity: ErrorSeverity.high,
				message: 'Connection error detected',
				originalError: error,
				context,
				shouldRetry: true,
				shouldFallback: true,
			};
		}

		// Timeout errors
		if (this.isTimeoutError(errorMessage)) {
			return {
				category: ErrorCategory.timeout,
				severity: ErrorSeverity.medium,
				message: 'Operation timeout',
				originalError: error,
				context,
				shouldRetry: true,
				shouldFallback: true,
			};
		}

		// Serialization errors
		if (this.isSerializationError(errorMessage)) {
			return {
				category: ErrorCategory.serialization,
				severity: ErrorSeverity.medium,
				message: 'Message serialization failed',
				originalError: error,
				context,
				shouldRetry: false,
				shouldFallback: false, // Don't fallback invalid messages
			};
		}

		// Circuit breaker errors
		if (this.isCircuitBreakerError(errorMessage)) {
			return {
				category: ErrorCategory.circuitBreaker,
				severity: ErrorSeverity.medium,
				message: 'Circuit breaker is open',
				originalError: error,
				context,
				shouldRetry: false, // Circuit breaker handles retry logic
				shouldFallback: true,
			};
		}

		// Queue overflow errors
		if (this.isQueueOverflowError(errorMessage)) {
			return {
				category: ErrorCategory.queueOverflow,
				severity: ErrorSeverity.medium,
				message: 'Message queue overflow',
				originalError: error,
				context,
				shouldRetry: false,
				shouldFallback: true,
			};
		}

		// Message sending errors
		if (this.isMessageSendingError(errorMessage)) {
			return {
				category: ErrorCategory.messageSending,
				severity: ErrorSeverity.medium,
				message: 'Failed to send message to Kafka',
				originalError: error,
				context,
				shouldRetry: true,
				shouldFallback: true,
			};
		}

		// Unknown errors
		return {
			category: ErrorCategory.unknown,
			severity: ErrorSeverity.medium,
			message: 'Unknown error occurred',
			originalError: error,
			context,
			shouldRetry: true,
			shouldFallback: true,
		};
	}

	/**
	 * Handle an error with appropriate logging and fallback strategies
	 */
	handleError(error: Error, context?: Record<string, unknown>): CategorizedError {
		const categorizedError = this.categorizeError(error, context);

		// Log the error with appropriate level
		this.logCategorizedError(categorizedError);

		return categorizedError;
	}

	/**
	 * Log execution message to local fallback when Kafka is unavailable
	 */
	logToFallback(message: ExecutionLogMessage, reason: string): void {
		if (!this.fallbackConfig.enabled) {
			return;
		}

		try {
			const fallbackEntry = {
				timestamp: new Date().toISOString(),
				reason,
				message,
			};

			const logLine = JSON.stringify(fallbackEntry) + '\n';

			// Check if we need to rotate the log file
			this.rotateLogFileIfNeeded(logLine.length);

			// Append to current log file
			appendFileSync(this.currentLogFile, logLine, 'utf8');

			this.logger.debug('Message logged to fallback file', {
				file: this.currentLogFile,
				reason,
				executionId: message.involves[0]?.id,
			});
		} catch (fallbackError) {
			// If fallback logging fails, log to main logger but don't throw
			this.logger.error('Failed to write to fallback log', {
				error: fallbackError,
				originalReason: reason,
				executionId: message.involves[0]?.id,
			});
		}
	}

	/**
	 * Log multiple messages to fallback in batch
	 */
	logBatchToFallback(messages: ExecutionLogMessage[], reason: string): void {
		if (!this.fallbackConfig.enabled || messages.length === 0) {
			return;
		}

		try {
			const batchEntry = {
				timestamp: new Date().toISOString(),
				reason,
				messageCount: messages.length,
				messages,
			};

			const logLine = JSON.stringify(batchEntry) + '\n';

			// Check if we need to rotate the log file
			this.rotateLogFileIfNeeded(logLine.length);

			// Append to current log file
			appendFileSync(this.currentLogFile, logLine, 'utf8');

			this.logger.debug('Batch logged to fallback file', {
				file: this.currentLogFile,
				reason,
				messageCount: messages.length,
			});
		} catch (fallbackError) {
			this.logger.error('Failed to write batch to fallback log', {
				error: fallbackError,
				originalReason: reason,
				messageCount: messages.length,
			});
		}
	}

	/**
	 * Initialize fallback logging directory and files
	 */
	private initializeFallbackLogging(): void {
		try {
			// Create log directory if it doesn't exist
			if (!existsSync(this.fallbackLogPath)) {
				mkdirSync(this.fallbackLogPath, { recursive: true });
			}

			// Rotate logs on startup if configured
			if (this.fallbackConfig.rotateOnStartup) {
				this.rotateLogFiles();
			}

			// Create initial log file if it doesn't exist
			if (!existsSync(this.currentLogFile)) {
				writeFileSync(this.currentLogFile, '', 'utf8');
			}

			this.logger.info('Fallback logging initialized', {
				directory: this.fallbackLogPath,
				currentFile: this.currentLogFile,
			});
		} catch (error) {
			this.logger.error('Failed to initialize fallback logging', { error });
			// Don't throw - fallback logging is optional
		}
	}

	/**
	 * Rotate log file if it exceeds maximum size
	 */
	private rotateLogFileIfNeeded(additionalSize: number): void {
		try {
			const stats = existsSync(this.currentLogFile) ? statSync(this.currentLogFile) : { size: 0 };

			if (stats.size + additionalSize > this.fallbackConfig.maxFileSize) {
				this.rotateLogFiles();
			}
		} catch (error) {
			this.logger.warn('Failed to check log file size for rotation', { error });
		}
	}

	/**
	 * Rotate log files by moving current to next index
	 */
	private rotateLogFiles(): void {
		try {
			// Remove oldest log file if we've reached the limit
			const oldestFile = join(
				this.fallbackLogPath,
				`kafka-fallback-${this.fallbackConfig.maxFiles - 1}.log`,
			);
			if (existsSync(oldestFile)) {
				unlinkSync(oldestFile);
			}

			// Shift all existing log files
			for (let i = this.fallbackConfig.maxFiles - 2; i >= 0; i--) {
				const currentFile = join(this.fallbackLogPath, `kafka-fallback-${i}.log`);
				const nextFile = join(this.fallbackLogPath, `kafka-fallback-${i + 1}.log`);

				if (existsSync(currentFile)) {
					renameSync(currentFile, nextFile);
				}
			}

			// Create new current log file
			this.currentLogFile = join(this.fallbackLogPath, 'kafka-fallback-0.log');
			writeFileSync(this.currentLogFile, '', 'utf8');

			this.logger.info('Log files rotated', { newFile: this.currentLogFile });
		} catch (error) {
			this.logger.error('Failed to rotate log files', { error });
		}
	}

	/**
	 * Log categorized error with appropriate level and context
	 */
	private logCategorizedError(categorizedError: CategorizedError): void {
		const logContext = {
			category: categorizedError.category,
			severity: categorizedError.severity,
			shouldRetry: categorizedError.shouldRetry,
			shouldFallback: categorizedError.shouldFallback,
			error: categorizedError.originalError.message,
			stack: categorizedError.originalError.stack,
			...categorizedError.context,
		};

		switch (categorizedError.severity) {
			case ErrorSeverity.critical:
				this.logger.error(`[${categorizedError.category}] ${categorizedError.message}`, logContext);
				break;
			case ErrorSeverity.high:
				this.logger.error(`[${categorizedError.category}] ${categorizedError.message}`, logContext);
				break;
			case ErrorSeverity.medium:
				this.logger.warn(`[${categorizedError.category}] ${categorizedError.message}`, logContext);
				break;
			case ErrorSeverity.low:
				this.logger.info(`[${categorizedError.category}] ${categorizedError.message}`, logContext);
				break;
		}
	}

	// Error detection methods
	private isConfigurationError(message: string): boolean {
		return (
			message.includes('configuration') ||
			message.includes('invalid') ||
			message.includes('missing') ||
			(message.includes('broker') && message.includes('format')) ||
			(message.includes('topic') && message.includes('empty')) ||
			(message.includes('client id') && message.includes('empty'))
		);
	}

	private isAuthenticationError(message: string): boolean {
		return (
			message.includes('authentication') ||
			message.includes('unauthorized') ||
			message.includes('sasl') ||
			message.includes('credentials') ||
			message.includes('login') ||
			message.includes('auth')
		);
	}

	private isConnectionError(message: string): boolean {
		return (
			message.includes('connection') ||
			message.includes('connect') ||
			message.includes('network') ||
			(message.includes('broker') && message.includes('unavailable')) ||
			message.includes('econnrefused') ||
			message.includes('enotfound') ||
			message.includes('ehostunreach')
		);
	}

	private isTimeoutError(message: string): boolean {
		return (
			message.includes('timeout') || message.includes('timed out') || message.includes('etimedout')
		);
	}

	private isSerializationError(message: string): boolean {
		return (
			message.includes('serialization') ||
			message.includes('json') ||
			message.includes('parse') ||
			message.includes('stringify') ||
			message.includes('invalid message format')
		);
	}

	private isCircuitBreakerError(message: string): boolean {
		return (
			message.includes('circuit breaker') ||
			(message.includes('circuit') && message.includes('open'))
		);
	}

	private isQueueOverflowError(message: string): boolean {
		return (
			(message.includes('queue') && (message.includes('full') || message.includes('overflow'))) ||
			message.includes('message dropped')
		);
	}

	private isMessageSendingError(message: string): boolean {
		return (
			message.includes('send') ||
			message.includes('publish') ||
			message.includes('produce') ||
			(message.includes('kafka') && message.includes('failed'))
		);
	}
}
