import { Logger } from '@n8n/backend-common';
import { Service } from '@n8n/di';
import type { ExecutionLifecycleHooks } from 'n8n-core';
import { join } from 'path';

import type {
	IKafkaExecutionLogger,
	WorkflowExecutionContext,
} from './kafka-execution-logger.interface';
import type {
	IMessageQueue,
	ICircuitBreaker,
	IKafkaProducerWrapper,
	IHealthMetrics,
	CircuitBreakerConfig,
} from '../components';
import { MessageQueue, CircuitBreaker, KafkaProducerWrapper, HealthMetrics } from '../components';
import type { KafkaLoggerConfig, ExecutionLogMessage } from '../models';
import { KafkaConfigLoader, SegmentEventBuilder } from '../utils';
import { ErrorHandler, ErrorCategory, type FallbackLoggerConfig } from '../utils/error-handler';

/**
 * The main service class for Kafka Execution Logger
 * Orchestrates all components and handles workflow execution events
 */
@Service()
export class KafkaExecutionLogger implements IKafkaExecutionLogger {
	private config: KafkaLoggerConfig;
	private messageQueue: IMessageQueue;
	private circuitBreaker: ICircuitBreaker;
	private kafkaProducer: IKafkaProducerWrapper;
	private healthMetrics: IHealthMetrics;
	private errorHandler: ErrorHandler;
	private flushTimer?: NodeJS.Timeout;
	private isInitialized = false;
	private isShuttingDown = false;

	constructor(
		private readonly logger: Logger,
		private readonly configLoader: KafkaConfigLoader,
	) {}

	/**
	 * Initialize the service and all components
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		try {
			this.logger.info('Initializing Kafka Execution Logger...');

			// Load configuration
			this.config = this.configLoader.loadConfig();

			// Check if service is enabled
			if (!this.config.enabled) {
				this.logger.info('Kafka Execution Logger is disabled');
				return;
			}

			// Initialize components (including error handler)
			this.initializeComponents();

			// Connect to Kafka
			await this.connectToKafka();

			// Start background processing
			this.startBackgroundProcessing();

			this.isInitialized = true;
			this.logger.info('Kafka Execution Logger initialized successfully');
		} catch (error) {
			// Use error handler if available, otherwise handle manually
			if (this.errorHandler) {
				const categorizedError = this.errorHandler.handleError(error as Error, {
					operation: 'initialize',
					config: this.config,
				});

				// For configuration errors, disable the service but don't throw
				if (categorizedError.category === ErrorCategory.configuration) {
					this.logger.error('Configuration error - Kafka Execution Logger disabled', { error });
					this.config = { ...this.config, enabled: false };
					return;
				}
			} else {
				// Error handler not initialized yet, handle manually
				this.logger.error('Failed to initialize Kafka Execution Logger', { error });

				// If it's a configuration-related error, disable the service
				const errorMessage = (error as Error).message.toLowerCase();
				if (errorMessage.includes('configuration') || errorMessage.includes('config')) {
					this.config = { ...this.config, enabled: false };
					return;
				}
			}

			this.logger.error('Failed to initialize Kafka Execution Logger', { error });
			throw error;
		}
	}

	/**
	 * Shutdown the service and cleanup resources
	 */
	async shutdown(): Promise<void> {
		if (!this.isInitialized || this.isShuttingDown) {
			return;
		}

		this.isShuttingDown = true;
		this.logger.info('Shutting down Kafka Execution Logger...');

		try {
			// Stop background processing
			if (this.flushTimer) {
				clearInterval(this.flushTimer);
				this.flushTimer = undefined;
			}

			// Flush remaining messages
			await this.flushQueuedMessages();

			// Disconnect from Kafka
			if (this.kafkaProducer) {
				await this.kafkaProducer.disconnect();
			}

			this.logger.info('Kafka Execution Logger shutdown completed');
		} catch (error) {
			this.logger.error('Error during Kafka Execution Logger shutdown', { error });
		} finally {
			this.isInitialized = false;
			this.isShuttingDown = false;
		}
	}

	/**
	 * Handle workflow execution start event
	 */
	async handleWorkflowStart(context: WorkflowExecutionContext): Promise<void> {
		if (!this.isInitialized || !this.config?.enabled) {
			return;
		}

		try {
			const message = SegmentEventBuilder.buildWorkflowStartEvent(context);
			await this.processMessage(message);
		} catch (error) {
			const categorizedError = this.errorHandler.handleError(error as Error, {
				operation: 'handleWorkflowStart',
				executionId: context.executionId,
				workflowId: context.workflowData.id,
			});

			// For serialization errors, skip the message
			if (categorizedError.category === ErrorCategory.serialization) {
				this.logger.warn('Skipping workflow start event due to serialization error', {
					executionId: context.executionId,
					workflowId: context.workflowData.id,
				});
				return;
			}

			// For other errors, try fallback logging if enabled
			if (categorizedError.shouldFallback) {
				try {
					const message = SegmentEventBuilder.buildWorkflowStartEvent(context);
					this.errorHandler.logToFallback(message, `Kafka error: ${categorizedError.category}`);
				} catch (fallbackError) {
					// Fallback failed, but don't throw - workflow execution must continue
					this.logger.error('Fallback logging failed for workflow start event', {
						executionId: context.executionId,
						workflowId: context.workflowData.id,
						fallbackError,
					});
				}
			}
		}
	}

	/**
	 * Handle workflow execution completion event
	 */
	async handleWorkflowComplete(context: WorkflowExecutionContext): Promise<void> {
		if (!this.isInitialized || !this.config.enabled) {
			return;
		}

		try {
			const message = SegmentEventBuilder.buildWorkflowCompleteEvent(context);
			await this.processMessage(message);
		} catch (error) {
			const categorizedError = this.errorHandler.handleError(error as Error, {
				operation: 'handleWorkflowComplete',
				executionId: context.executionId,
				workflowId: context.workflowData.id,
			});

			// For serialization errors, skip the message
			if (categorizedError.category === ErrorCategory.serialization) {
				this.logger.warn('Skipping workflow complete event due to serialization error', {
					executionId: context.executionId,
					workflowId: context.workflowData.id,
				});
				return;
			}

			// For other errors, try fallback logging if enabled
			if (categorizedError.shouldFallback) {
				try {
					const message = SegmentEventBuilder.buildWorkflowCompleteEvent(context);
					this.errorHandler.logToFallback(message, `Kafka error: ${categorizedError.category}`);
				} catch (fallbackError) {
					this.logger.error('Fallback logging failed for workflow complete event', {
						executionId: context.executionId,
						workflowId: context.workflowData.id,
						fallbackError,
					});
				}
			}
		}
	}

	/**
	 * Handle workflow execution error event
	 */
	async handleWorkflowError(context: WorkflowExecutionContext): Promise<void> {
		if (!this.isInitialized || !this.config.enabled) {
			return;
		}

		try {
			const message = SegmentEventBuilder.buildWorkflowErrorEvent(context);
			await this.processMessage(message);
		} catch (error) {
			const categorizedError = this.errorHandler.handleError(error as Error, {
				operation: 'handleWorkflowError',
				executionId: context.executionId,
				workflowId: context.workflowData.id,
			});

			// For serialization errors, skip the message
			if (categorizedError.category === ErrorCategory.serialization) {
				this.logger.warn('Skipping workflow error event due to serialization error', {
					executionId: context.executionId,
					workflowId: context.workflowData.id,
				});
				return;
			}

			// For other errors, try fallback logging if enabled
			if (categorizedError.shouldFallback) {
				try {
					const message = SegmentEventBuilder.buildWorkflowErrorEvent(context);
					this.errorHandler.logToFallback(message, `Kafka error: ${categorizedError.category}`);
				} catch (fallbackError) {
					this.logger.error('Fallback logging failed for workflow error event', {
						executionId: context.executionId,
						workflowId: context.workflowData.id,
						fallbackError,
					});
				}
			}
		}
	}

	/**
	 * Handle workflow execution cancel event
	 */
	async handleWorkflowCancel(context: WorkflowExecutionContext): Promise<void> {
		if (!this.isInitialized || !this.config.enabled) {
			return;
		}

		try {
			const message = SegmentEventBuilder.buildWorkflowCancelEvent(context);
			await this.processMessage(message);
		} catch (error) {
			const categorizedError = this.errorHandler.handleError(error as Error, {
				operation: 'handleWorkflowCancel',
				executionId: context.executionId,
				workflowId: context.workflowData.id,
			});

			// For serialization errors, skip the message
			if (categorizedError.category === ErrorCategory.serialization) {
				this.logger.warn('Skipping workflow cancel event due to serialization error', {
					executionId: context.executionId,
					workflowId: context.workflowData.id,
				});
				return;
			}

			// For other errors, try fallback logging if enabled
			if (categorizedError.shouldFallback) {
				try {
					const message = SegmentEventBuilder.buildWorkflowCancelEvent(context);
					this.errorHandler.logToFallback(message, `Kafka error: ${categorizedError.category}`);
				} catch (fallbackError) {
					this.logger.error('Fallback logging failed for workflow cancel event', {
						executionId: context.executionId,
						workflowId: context.workflowData.id,
						fallbackError,
					});
				}
			}
		}
	}

	/**
	 * Register lifecycle hooks with the provided ExecutionLifecycleHooks instance
	 * This method should be called during workflow execution setup
	 */
	registerLifecycleHooks(hooks: ExecutionLifecycleHooks): void {
		if (!this.isInitialized || !this.config?.enabled) {
			return;
		}

		// Capture service instance in closure for hook handlers
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const kafkaLogger = this;

		// Register workflowExecuteBefore hook
		hooks.addHandler('workflowExecuteBefore', function () {
			try {
				// Extract execution context from hook's 'this' context
				const executionContext: WorkflowExecutionContext = {
					executionId: this.executionId,
					workflowData: this.workflowData,
					mode: this.mode,
					startedAt: new Date(),
				};

				// Handle the workflow start event asynchronously to avoid blocking execution
				setImmediate(() => {
					kafkaLogger.handleWorkflowStart(executionContext).catch((error: Error) => {
						kafkaLogger.logger.error('Async error in workflow start handler', {
							executionId: executionContext.executionId,
							workflowId: executionContext.workflowData.id,
							error,
						});
					});
				});
			} catch (error) {
				// Log error but don't throw to avoid disrupting workflow execution
				kafkaLogger.logger.error('Error in workflowExecuteBefore lifecycle hook', {
					executionId: this.executionId,
					workflowId: this.workflowData.id,
					error,
				});
			}
		});

		// Register workflowExecuteAfter hook
		hooks.addHandler('workflowExecuteAfter', function (runData, newStaticData) {
			try {
				// Extract execution context from hook's 'this' context and parameters
				const executionContext: WorkflowExecutionContext = {
					executionId: this.executionId,
					workflowData: this.workflowData,
					mode: this.mode,
					runData,
					newStaticData,
					startedAt: runData.startedAt ? new Date(String(runData.startedAt)) : undefined,
					// finishedAt: runData.finishedAt ? new Date(String(runData.finishedAt)) : new Date(),
				};

				// Handle the workflow completion event asynchronously to avoid blocking execution
				setImmediate(() => {
					// Determine the appropriate handler based on workflow status
					let handler;
					if (runData.status === 'success') {
						handler = kafkaLogger.handleWorkflowComplete(executionContext);
					} else if (runData.status === 'canceled') {
						handler = kafkaLogger.handleWorkflowCancel(executionContext);
					} else {
						handler = kafkaLogger.handleWorkflowError(executionContext);
					}

					handler.catch((error: Error) => {
						kafkaLogger.logger.error('Async error in workflow completion handler', {
							executionId: executionContext.executionId,
							workflowId: executionContext.workflowData.id,
							status: runData.status,
							error,
						});
					});
				});
			} catch (error) {
				// Log error but don't throw to avoid disrupting workflow execution
				kafkaLogger.logger.error('Error in workflowExecuteAfter lifecycle hook', {
					executionId: this.executionId,
					workflowId: this.workflowData.id,
					status: runData.status,
					error,
				});
			}
		});
	}

	/**
	 * Initialize all components with configuration
	 */
	private initializeComponents(): void {
		// Initialize error handler with fallback logging
		const fallbackConfig: FallbackLoggerConfig = {
			enabled: true,
			logDirectory: join(process.cwd(), 'logs', 'kafka-fallback'),
			maxFileSize: 10 * 1024 * 1024, // 10MB
			maxFiles: 5,
			rotateOnStartup: true,
		};
		this.errorHandler = new ErrorHandler(this.logger, fallbackConfig);

		// Initialize message queue
		this.messageQueue = new MessageQueue(this.config.queue.maxSize);

		// Initialize circuit breaker
		const circuitBreakerConfig: CircuitBreakerConfig = {
			failureThreshold: this.config.circuitBreaker.failureThreshold,
			resetTimeout: this.config.circuitBreaker.resetTimeout,
			monitoringPeriod: this.config.circuitBreaker.monitoringPeriod,
		};
		this.circuitBreaker = new CircuitBreaker(circuitBreakerConfig);

		// Initialize Kafka producer wrapper
		this.kafkaProducer = new KafkaProducerWrapper(this.config, this.logger);

		// Initialize health metrics
		this.healthMetrics = new HealthMetrics();
	}

	/**
	 * Connect to Kafka with circuit breaker protection
	 */
	private async connectToKafka(): Promise<void> {
		try {
			await this.circuitBreaker.execute(async () => {
				await this.kafkaProducer.connect();
			});
			this.logger.info('Connected to Kafka successfully');
		} catch (error) {
			const categorizedError = this.errorHandler.handleError(error as Error, {
				operation: 'connect',
				brokers: this.config.kafka.brokers,
			});

			// For authentication or configuration errors, don't retry
			if (
				categorizedError.category === ErrorCategory.authentication ||
				categorizedError.category === ErrorCategory.configuration
			) {
				this.logger.error('Critical connection error - disabling Kafka logging', { error });
				this.config = { ...this.config, enabled: false };
				return;
			}

			this.logger.warn('Failed to connect to Kafka, will retry later', { error });
			// Don't throw - service should continue with queuing
		}
	}

	/**
	 * Start background processing for queued messages
	 */
	private startBackgroundProcessing(): void {
		this.flushTimer = setInterval(() => {
			void this.flushQueuedMessages();
		}, this.config.queue.flushInterval);
	}

	/**
	 * Process a message by either sending immediately or queuing
	 */
	private async processMessage(message: ExecutionLogMessage): Promise<void> {
		// Update queue depth metric
		this.healthMetrics.setQueueDepth(this.messageQueue.size());
		this.healthMetrics.setCircuitBreakerState(this.circuitBreaker.getState());

		// Try to send immediately if circuit is closed and producer is connected
		if (
			this.circuitBreaker.getState() === 'Closed' &&
			this.kafkaProducer.isConnected() &&
			this.messageQueue.size() === 0
		) {
			try {
				await this.circuitBreaker.execute(async () => {
					await this.kafkaProducer.send(message);
				});
				this.healthMetrics.incrementSuccess();
				return;
			} catch (error) {
				const categorizedError = this.errorHandler.handleError(error as Error, {
					operation: 'sendImmediate',
					executionId: message.involves[0]?.id,
					event: message.event,
				});

				this.healthMetrics.incrementFailure();

				// For non-retryable errors, try fallback logging
				if (!categorizedError.shouldRetry && categorizedError.shouldFallback) {
					this.errorHandler.logToFallback(
						message,
						`Immediate send failed: ${categorizedError.category}`,
					);
					return;
				}

				this.logger.debug('Failed to send message immediately, queuing', { error });
			}
		}

		// Queue the message
		const queued = this.messageQueue.enqueue(message);
		if (!queued) {
			// Queue is full - log to fallback if possible
			this.errorHandler.handleError(new Error('Message queue is full, message dropped'), {
				operation: 'enqueue',
				executionId: message.involves[0]?.id,
				event: message.event,
				queueSize: this.messageQueue.size(),
			});

			this.errorHandler.logToFallback(message, 'Queue overflow - message dropped');
		}

		// Update queue depth metric
		this.healthMetrics.setQueueDepth(this.messageQueue.size());
	}

	/**
	 * Flush queued messages to Kafka
	 */
	private async flushQueuedMessages(): Promise<void> {
		if (this.messageQueue.size() === 0) {
			return;
		}

		// Update circuit breaker state metric
		this.healthMetrics.setCircuitBreakerState(this.circuitBreaker.getState());

		// Skip if circuit is open
		if (this.circuitBreaker.getState() === 'Open') {
			return;
		}

		// Skip if not connected
		if (!this.kafkaProducer.isConnected()) {
			try {
				await this.circuitBreaker.execute(async () => {
					await this.kafkaProducer.connect();
				});
			} catch (error) {
				const categorizedError = this.errorHandler.handleError(error as Error, {
					operation: 'reconnect',
					queueSize: this.messageQueue.size(),
				});

				// For authentication or configuration errors, disable service
				if (
					categorizedError.category === ErrorCategory.authentication ||
					categorizedError.category === ErrorCategory.configuration
				) {
					this.logger.error('Critical error during reconnection - disabling Kafka logging', {
						error,
					});
					this.config = { ...this.config, enabled: false };
				}

				this.logger.debug('Failed to reconnect to Kafka', { error });
				return;
			}
		}

		// Process messages in batches
		const batchSize = this.config.queue.batchSize;
		const messages = this.messageQueue.dequeueBatch(batchSize);

		if (messages.length === 0) {
			return;
		}

		try {
			await this.circuitBreaker.execute(async () => {
				if (messages.length === 1) {
					await this.kafkaProducer.send(messages[0]);
				} else {
					await this.kafkaProducer.sendBatch(messages);
				}
			});

			this.healthMetrics.incrementSuccess();
			this.logger.debug(`Successfully sent ${messages.length} messages to Kafka`);
		} catch (error) {
			const categorizedError = this.errorHandler.handleError(error as Error, {
				operation: 'flushBatch',
				messageCount: messages.length,
				queueSize: this.messageQueue.size(),
			});

			this.healthMetrics.incrementFailure();

			// Handle different error categories
			if (categorizedError.shouldRetry) {
				// Re-queue messages (they were already dequeued)
				// Note: Messages will be added to the end of the queue, which may affect ordering
				// but ensures they are not lost during transient failures
				for (const message of messages) {
					const requeued = this.messageQueue.enqueue(message);
					if (!requeued) {
						// Queue is full, log to fallback
						this.errorHandler.logToFallback(message, 'Re-queue failed after send error');
					}
				}
			} else if (categorizedError.shouldFallback) {
				// Log all messages to fallback
				this.errorHandler.logBatchToFallback(messages, `Send failed: ${categorizedError.category}`);
			}

			// For authentication or configuration errors, disable service
			if (
				categorizedError.category === ErrorCategory.authentication ||
				categorizedError.category === ErrorCategory.configuration
			) {
				this.logger.error('Critical error during batch send - disabling Kafka logging', { error });
				this.config = { ...this.config, enabled: false };
			}
		} finally {
			// Update queue depth metric
			this.healthMetrics.setQueueDepth(this.messageQueue.size());
		}
	}

	/**
	 * Get health metrics for monitoring
	 */
	getHealthMetrics() {
		return this.healthMetrics.getMetrics();
	}

	/**
	 * Get current configuration (for testing/debugging)
	 */
	getConfig(): KafkaLoggerConfig {
		return this.config;
	}

	/**
	 * Check if service is initialized and enabled
	 */
	isEnabled(): boolean {
		return this.isInitialized && this.config?.enabled;
	}

	/**
	 * Manually trigger flush for testing purposes
	 * @internal
	 */
	async triggerFlush(): Promise<void> {
		await this.flushQueuedMessages();
	}
}
