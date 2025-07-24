import type { Logger } from '@n8n/backend-common';
import { mock } from 'jest-mock-extended';
import { existsSync, statSync } from 'fs';
import { join } from 'path';

import {
	ErrorHandler,
	ErrorCategory,
	ErrorSeverity,
	type FallbackLoggerConfig,
} from '../utils/error-handler';
import type { ExecutionLogMessage } from '../models';

// Mock fs functions
jest.mock('fs', () => ({
	existsSync: jest.fn(),
	statSync: jest.fn(),
	writeFileSync: jest.fn(),
	appendFileSync: jest.fn(),
	mkdirSync: jest.fn(),
	unlinkSync: jest.fn(),
	renameSync: jest.fn(),
}));

jest.mock('path', () => ({
	join: jest.fn(),
}));

// Get the mocked functions
const mockExistsSync = jest.mocked(existsSync);
const mockStatSync = jest.mocked(statSync);
const mockWriteFileSync = jest.mocked(require('fs').writeFileSync);
const mockAppendFileSync = jest.mocked(require('fs').appendFileSync);
const mockMkdirSync = jest.mocked(require('fs').mkdirSync);
const mockUnlinkSync = jest.mocked(require('fs').unlinkSync);
const mockRenameSync = jest.mocked(require('fs').renameSync);
const mockJoin = jest.mocked(join);

describe('ErrorHandler', () => {
	let errorHandler: ErrorHandler;
	let mockLogger: Logger;
	let fallbackConfig: FallbackLoggerConfig;

	const createMockMessage = (): ExecutionLogMessage => ({
		type: 'track',
		event: 'Workflow Started',
		userId: 'user-123',
		timestamp: '2023-01-01T10:00:00.000Z',
		messageId: 'msg-123',
		dimensions: {
			execution_mode: 'manual',
			workflow_name: 'Test Workflow',
		},
		flags: {
			is_manual_execution: true,
			is_retry: false,
		},
		metrics: {
			node_count: 1,
		},
		tags: [],
		involves: [
			{
				role: 'WorkflowExecution',
				id: 'exec-123',
				id_type: 'n8n',
			},
			{
				role: 'Workflow',
				id: 'workflow-456',
				id_type: 'n8n',
			},
		],
		properties: {
			started_at: '2023-01-01T10:00:00.000Z',
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
				execution_mode: 'manual' as any,
				instance_type: 'main',
			},
		},
	});

	beforeEach(() => {
		jest.clearAllMocks();

		mockLogger = mock<Logger>();
		fallbackConfig = {
			enabled: true,
			logDirectory: '/test/logs',
			maxFileSize: 1024 * 1024, // 1MB
			maxFiles: 3,
			rotateOnStartup: false,
		};

		// Setup default mock behaviors
		mockJoin.mockImplementation((...paths) => paths.join('/'));
		mockExistsSync.mockReturnValue(false);
		mockStatSync.mockReturnValue({ size: 0 } as any);

		errorHandler = new ErrorHandler(mockLogger, fallbackConfig);
	});

	describe('error categorization', () => {
		it('should categorize configuration errors correctly', () => {
			const error = new Error('Invalid configuration: missing broker');
			const result = errorHandler.categorizeError(error);

			expect(result.category).toBe(ErrorCategory.configuration);
			expect(result.severity).toBe(ErrorSeverity.critical);
			expect(result.shouldRetry).toBe(false);
			expect(result.shouldFallback).toBe(true);
		});

		it('should categorize authentication errors correctly', () => {
			const error = new Error('SASL authentication failed');
			const result = errorHandler.categorizeError(error);

			expect(result.category).toBe(ErrorCategory.authentication);
			expect(result.severity).toBe(ErrorSeverity.high);
			expect(result.shouldRetry).toBe(false);
			expect(result.shouldFallback).toBe(true);
		});

		it('should categorize connection errors correctly', () => {
			const error = new Error('Connection refused ECONNREFUSED');
			const result = errorHandler.categorizeError(error);

			expect(result.category).toBe(ErrorCategory.connection);
			expect(result.severity).toBe(ErrorSeverity.high);
			expect(result.shouldRetry).toBe(true);
			expect(result.shouldFallback).toBe(true);
		});

		it('should categorize timeout errors correctly', () => {
			const error = new Error('Operation timed out');
			const result = errorHandler.categorizeError(error);

			expect(result.category).toBe(ErrorCategory.timeout);
			expect(result.severity).toBe(ErrorSeverity.medium);
			expect(result.shouldRetry).toBe(true);
			expect(result.shouldFallback).toBe(true);
		});

		it('should categorize serialization errors correctly', () => {
			const error = new Error('JSON parse error');
			const result = errorHandler.categorizeError(error);

			expect(result.category).toBe(ErrorCategory.serialization);
			expect(result.severity).toBe(ErrorSeverity.medium);
			expect(result.shouldRetry).toBe(false);
			expect(result.shouldFallback).toBe(false);
		});

		it('should categorize circuit breaker errors correctly', () => {
			const error = new Error('Circuit breaker is open');
			const result = errorHandler.categorizeError(error);

			expect(result.category).toBe(ErrorCategory.circuitBreaker);
			expect(result.severity).toBe(ErrorSeverity.medium);
			expect(result.shouldRetry).toBe(false);
			expect(result.shouldFallback).toBe(true);
		});

		it('should categorize queue overflow errors correctly', () => {
			const error = new Error('Message queue is full');
			const result = errorHandler.categorizeError(error);

			expect(result.category).toBe(ErrorCategory.queueOverflow);
			expect(result.severity).toBe(ErrorSeverity.medium);
			expect(result.shouldRetry).toBe(false);
			expect(result.shouldFallback).toBe(true);
		});

		it('should categorize message sending errors correctly', () => {
			const error = new Error('Failed to send message to Kafka');
			const result = errorHandler.categorizeError(error);

			expect(result.category).toBe(ErrorCategory.messageSending);
			expect(result.severity).toBe(ErrorSeverity.medium);
			expect(result.shouldRetry).toBe(true);
			expect(result.shouldFallback).toBe(true);
		});

		it('should categorize unknown errors correctly', () => {
			const error = new Error('Some unknown error');
			const result = errorHandler.categorizeError(error);

			expect(result.category).toBe(ErrorCategory.unknown);
			expect(result.severity).toBe(ErrorSeverity.medium);
			expect(result.shouldRetry).toBe(true);
			expect(result.shouldFallback).toBe(true);
		});

		it('should include context in categorized error', () => {
			const error = new Error('Test error');
			const context = { executionId: 'exec-123', operation: 'test' };
			const result = errorHandler.categorizeError(error, context);

			expect(result.context).toEqual(context);
			expect(result.originalError).toBe(error);
		});
	});

	describe('error handling', () => {
		it('should handle and log critical errors', () => {
			const error = new Error('Invalid configuration');
			const result = errorHandler.handleError(error);

			expect(result.category).toBe(ErrorCategory.configuration);
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('[CONFIGURATION]'),
				expect.objectContaining({
					category: ErrorCategory.configuration,
					severity: ErrorSeverity.critical,
				}),
			);
		});

		it('should handle and log high severity errors', () => {
			const error = new Error('Authentication failed');
			const result = errorHandler.handleError(error);

			expect(result.category).toBe(ErrorCategory.authentication);
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('[AUTHENTICATION]'),
				expect.objectContaining({
					category: ErrorCategory.authentication,
					severity: ErrorSeverity.high,
				}),
			);
		});

		it('should handle and log medium severity errors', () => {
			const error = new Error('Operation timeout');
			const result = errorHandler.handleError(error);

			expect(result.category).toBe(ErrorCategory.timeout);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('[TIMEOUT]'),
				expect.objectContaining({
					category: ErrorCategory.timeout,
					severity: ErrorSeverity.medium,
				}),
			);
		});

		it('should include error stack in log context', () => {
			const error = new Error('Test error');
			error.stack = 'Error stack trace';

			errorHandler.handleError(error);

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					stack: 'Error stack trace',
				}),
			);
		});
	});

	describe('fallback logging', () => {
		beforeEach(() => {
			// Setup mocks for successful file operations
			mockExistsSync.mockReturnValue(true);
		});

		it('should log single message to fallback when enabled', () => {
			const message = createMockMessage();
			const reason = 'Kafka unavailable';

			errorHandler.logToFallback(message, reason);

			expect(mockAppendFileSync).toHaveBeenCalledWith(
				'/test/logs/kafka-fallback-0.log',
				expect.stringContaining(reason),
				'utf8',
			);
		});

		it('should log batch messages to fallback when enabled', () => {
			const messages = [createMockMessage(), createMockMessage()];
			const reason = 'Batch send failed';

			errorHandler.logBatchToFallback(messages, reason);

			expect(mockAppendFileSync).toHaveBeenCalledWith(
				'/test/logs/kafka-fallback-0.log',
				expect.stringContaining(reason),
				'utf8',
			);
		});

		it('should not log to fallback when disabled', () => {
			const disabledConfig = { ...fallbackConfig, enabled: false };
			const disabledHandler = new ErrorHandler(mockLogger, disabledConfig);
			const message = createMockMessage();

			disabledHandler.logToFallback(message, 'test reason');

			expect(mockAppendFileSync).not.toHaveBeenCalled();
		});

		it('should handle fallback logging errors gracefully', () => {
			mockAppendFileSync.mockImplementation(() => {
				throw new Error('File write failed');
			});

			const message = createMockMessage();

			// Should not throw
			expect(() => {
				errorHandler.logToFallback(message, 'test reason');
			}).not.toThrow();

			expect(mockLogger.error).toHaveBeenCalledWith(
				'Failed to write to fallback log',
				expect.objectContaining({
					error: expect.any(Error),
					originalReason: 'test reason',
				}),
			);
		});

		it('should rotate log files when size limit is exceeded', () => {
			// Mock file size to exceed limit
			mockStatSync.mockReturnValue({ size: fallbackConfig.maxFileSize + 1000 } as any);

			const message = createMockMessage();
			errorHandler.logToFallback(message, 'test reason');

			// Should attempt to rotate files
			expect(mockRenameSync).toHaveBeenCalled();
			expect(mockWriteFileSync).toHaveBeenCalledWith('/test/logs/kafka-fallback-0.log', '', 'utf8');
		});

		it('should create log directory if it does not exist', () => {
			mockExistsSync.mockReturnValueOnce(false); // Directory doesn't exist
			mockExistsSync.mockReturnValue(true); // File exists

			new ErrorHandler(mockLogger, fallbackConfig);

			expect(mockMkdirSync).toHaveBeenCalledWith('/test/logs', { recursive: true });
		});

		it('should handle directory creation errors gracefully', () => {
			mockExistsSync.mockReturnValue(false);
			mockMkdirSync.mockImplementation(() => {
				throw new Error('Permission denied');
			});

			// Should not throw during initialization
			expect(() => {
				new ErrorHandler(mockLogger, fallbackConfig);
			}).not.toThrow();

			expect(mockLogger.error).toHaveBeenCalledWith(
				'Failed to initialize fallback logging',
				expect.objectContaining({
					error: expect.any(Error),
				}),
			);
		});
	});

	describe('log rotation', () => {
		beforeEach(() => {
			mockExistsSync.mockReturnValue(true);
		});

		it('should remove oldest log file when max files reached', () => {
			const message = createMockMessage();

			// Mock file size to trigger rotation
			mockStatSync.mockReturnValue({ size: fallbackConfig.maxFileSize + 1000 } as any);

			errorHandler.logToFallback(message, 'test reason');

			// Should remove oldest file (index 2 for maxFiles=3)
			expect(mockUnlinkSync).toHaveBeenCalledWith('/test/logs/kafka-fallback-2.log');
		});

		it('should shift existing log files during rotation', () => {
			const message = createMockMessage();

			// Mock file size to trigger rotation
			mockStatSync.mockReturnValue({ size: fallbackConfig.maxFileSize + 1000 } as any);

			errorHandler.logToFallback(message, 'test reason');

			// Should rename files to shift them
			expect(mockRenameSync).toHaveBeenCalledWith(
				'/test/logs/kafka-fallback-1.log',
				'/test/logs/kafka-fallback-2.log',
			);
			expect(mockRenameSync).toHaveBeenCalledWith(
				'/test/logs/kafka-fallback-0.log',
				'/test/logs/kafka-fallback-1.log',
			);
		});

		it('should handle rotation errors gracefully', () => {
			mockUnlinkSync.mockImplementation(() => {
				throw new Error('File deletion failed');
			});

			const message = createMockMessage();
			mockStatSync.mockReturnValue({ size: fallbackConfig.maxFileSize + 1000 } as any);

			// Should not throw
			expect(() => {
				errorHandler.logToFallback(message, 'test reason');
			}).not.toThrow();

			expect(mockLogger.error).toHaveBeenCalledWith(
				'Failed to rotate log files',
				expect.objectContaining({
					error: expect.any(Error),
				}),
			);
		});
	});
});
