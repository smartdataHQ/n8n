# Kafka Execution Logger Integration Tests

This directory contains comprehensive integration tests for the Kafka Execution Logger feature. The tests cover real Kafka cluster integration, authentication mechanisms, failure scenarios, and Segment.com message format compliance.

## Overview

The integration tests validate:

- **Real Kafka Integration**: Tests with actual Kafka brokers
- **Authentication Mechanisms**: SASL/PLAIN, SASL/SCRAM-SHA-256, SASL/SCRAM-SHA-512, SSL/TLS
- **Failure Scenarios**: Network issues, Kafka unavailability, authentication failures
- **n8n Workflow Types**: Manual, trigger, webhook, retry, and other execution modes
- **Message Format Compliance**: Segment.com track event format validation
- **Circuit Breaker Behavior**: Failure threshold and recovery testing
- **Queue Management**: Message queuing during Kafka outages

## Prerequisites

### Required Software

- **Docker**: For running Kafka test environment
- **Docker Compose**: For orchestrating Kafka services
- **Node.js**: Version 18+ for running tests
- **pnpm or npm**: Package manager for dependencies

### Environment Setup

1. **Install Docker and Docker Compose**
   ```bash
   # macOS with Homebrew
   brew install docker docker-compose

   # Or install Docker Desktop which includes both
   ```

2. **Verify Docker is running**
   ```bash
   docker info
   ```

3. **Install Node.js dependencies**
   ```bash
   cd packages/cli
   pnpm install
   ```

## Running Integration Tests

### Quick Start

Run all integration tests with automatic Kafka setup:

```bash
./packages/cli/src/execution-lifecycle/kafka-execution-logger/__tests__/run-integration-tests.sh
```

### Manual Test Execution

1. **Start Kafka Environment**
   ```bash
   ./run-integration-tests.sh --start-only
   ```

2. **Run Tests Manually**
   ```bash
   cd packages/cli
   KAFKA_INTEGRATION_TESTS=true pnpm test src/execution-lifecycle/kafka-execution-logger/__tests__/integration.test.ts --run
   ```

3. **Stop Kafka Environment**
   ```bash
   ./run-integration-tests.sh --stop-only
   ```

### Test Options

- `--start-only`: Start Kafka environment without running tests
- `--stop-only`: Stop Kafka environment
- `--no-auth`: Skip authentication tests
- `--no-failure`: Skip failure scenario tests
- `--help`: Show usage information

## Test Environment

### Kafka Services

The test environment includes multiple Kafka brokers for different scenarios:

1. **Plain Kafka** (port 9092)
   - No authentication
   - No encryption
   - Used for basic integration tests

2. **SASL Kafka** (port 9093)
   - SASL/PLAIN authentication
   - SASL/SCRAM-SHA-256 authentication
   - Used for authentication tests

3. **SSL Kafka** (port 9094)
   - SSL/TLS encryption
   - Used for secure connection tests

### Test Credentials

For SASL authentication tests:

- **SASL/PLAIN**: username=`testuser`, password=`testuser-secret`
- **SASL/SCRAM-SHA-256**: username=`admin`, password=`admin-secret`

## Environment Variables

### Test Configuration

- `KAFKA_INTEGRATION_TESTS`: Enable/disable integration tests (default: `true`)
- `KAFKA_TIMEOUT`: Kafka startup timeout in seconds (default: `60`)

### Kafka Connection

- `KAFKA_BROKERS`: Comma-separated list of Kafka brokers
- `KAFKA_SSL`: Enable SSL/TLS (`true`/`false`)
- `KAFKA_USERNAME`: SASL username
- `KAFKA_PASSWORD`: SASL password
- `KAFKA_SASL_MECHANISM`: SASL mechanism (`plain`, `scram-sha-256`, `scram-sha-512`)

## Test Structure

### Integration Test Categories

1. **Component Integration Tests**
   - Service initialization and dependency injection
   - Component interaction validation
   - Configuration loading and validation

2. **Real Kafka Integration Tests**
   - Connection establishment and teardown
   - Message sending and receiving
   - Topic creation and management
   - Authentication mechanism validation

3. **Failure Scenario Tests**
   - Kafka unavailability handling
   - Network timeout scenarios
   - Authentication failure handling
   - Circuit breaker activation and recovery

4. **n8n Workflow Integration Tests**
   - Different execution modes (manual, trigger, webhook, etc.)
   - Retry execution handling
   - Error event processing
   - Workflow lifecycle event capture

5. **Message Format Compliance Tests**
   - Segment.com track event format validation
   - Required field presence verification
   - Data type and structure validation
   - Context Suite Extensions compliance

### Test Helpers

The `test-helpers.ts` file provides utilities for:

- Creating test execution contexts
- Generating test Kafka configurations
- Building test execution messages
- Validating Segment.com format compliance
- Simulating various error conditions

## Debugging Tests

### Viewing Kafka Logs

```bash
cd packages/cli/src/execution-lifecycle/kafka-execution-logger/__tests__
docker-compose -f docker-compose.test.yml logs kafka
```

### Connecting to Kafka Containers

```bash
# Connect to Kafka container
docker exec -it kafka-test-broker bash

# List topics
kafka-topics --bootstrap-server localhost:9092 --list

# Consume messages from test topic
kafka-console-consumer --bootstrap-server localhost:9092 --topic n8n-test-topic --from-beginning
```

### Test Debugging

Enable verbose test output:

```bash
KAFKA_INTEGRATION_TESTS=true DEBUG=* pnpm test src/execution-lifecycle/kafka-execution-logger/__tests__/integration.test.ts --run
```

## Continuous Integration

### GitHub Actions Integration

Add to your CI pipeline:

```yaml
name: Kafka Integration Tests
on: [push, pull_request]

jobs:
  kafka-integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install -g pnpm
      - run: pnpm install
      - run: ./packages/cli/src/execution-lifecycle/kafka-execution-logger/__tests__/run-integration-tests.sh
```

### Local Development

For local development, you can keep Kafka running:

```bash
# Start Kafka and keep it running
./run-integration-tests.sh --start-only

# Run tests multiple times during development
KAFKA_INTEGRATION_TESTS=true pnpm test src/execution-lifecycle/kafka-execution-logger/__tests__/integration.test.ts --run

# Stop Kafka when done
./run-integration-tests.sh --stop-only
```

## Performance Testing

### Load Testing

To test with high message volume:

```bash
# Set environment variables for load testing
export KAFKA_LOAD_TEST=true
export KAFKA_MESSAGE_COUNT=10000
export KAFKA_CONCURRENT_WORKFLOWS=100

# Run load tests
pnpm test src/execution-lifecycle/kafka-execution-logger/__tests__/integration.test.ts --run
```

### Memory Usage Monitoring

Monitor memory usage during tests:

```bash
# Monitor Docker container resources
docker stats kafka-test-broker

# Monitor Node.js process memory
node --max-old-space-size=4096 --expose-gc test-runner.js
```

## Troubleshooting

### Common Issues

1. **Docker not running**
   ```
   Error: Cannot connect to the Docker daemon
   ```
   Solution: Start Docker Desktop or Docker daemon

2. **Port conflicts**
   ```
   Error: Port 9092 is already in use
   ```
   Solution: Stop existing Kafka instances or change ports in docker-compose.test.yml

3. **Kafka startup timeout**
   ```
   Error: Kafka services failed to start within 60 seconds
   ```
   Solution: Increase `KAFKA_TIMEOUT` or check Docker resources

4. **Authentication failures**
   ```
   Error: Authentication failed
   ```
   Solution: Verify credentials in kafka_server_jaas.conf

### Log Analysis

Check test logs for specific error patterns:

```bash
# Check for connection errors
grep -i "connection" test-output.log

# Check for authentication errors
grep -i "auth" test-output.log

# Check for timeout errors
grep -i "timeout" test-output.log
```

## Contributing

### Adding New Tests

1. **Create test cases** in `integration.test.ts`
2. **Add test helpers** in `test-helpers.ts` if needed
3. **Update documentation** in this README
4. **Verify CI compatibility** with the test script

### Test Guidelines

- Use descriptive test names
- Include both positive and negative test cases
- Mock external dependencies appropriately
- Clean up resources in `afterEach`/`afterAll`
- Use test helpers for common operations
- Validate Segment.com format compliance
- Test error handling paths

### Code Coverage

Generate coverage reports:

```bash
KAFKA_INTEGRATION_TESTS=true pnpm test src/execution-lifecycle/kafka-execution-logger/__tests__/integration.test.ts --coverage
```

## Security Considerations

### Test Data

- Use randomly generated UUIDs for test data
- Don't commit real credentials to version control
- Use test-specific topics that are cleaned up
- Isolate test environments from production

### Network Security

- Test containers are isolated in Docker network
- No external network access required
- All test traffic stays within Docker environment
- SSL/TLS tests use self-signed certificates

## References

- [Kafka Documentation](https://kafka.apache.org/documentation/)
- [KafkaJS Library](https://kafka.js.org/)
- [Segment.com Track API](https://segment.com/docs/connections/spec/track/)
- [n8n Execution Lifecycle Hooks](https://docs.n8n.io/)
- [Jest Testing Framework](https://jestjs.io/)
- [Docker Compose](https://docs.docker.com/compose/)
