# Verifying Kafka Execution Logger Status

This guide provides methods to verify that the Kafka Execution Logger is properly configured, active, and working correctly.

## Prerequisites

- n8n instance with Kafka Execution Logger enabled
- Access to n8n logs
- Access to Kafka cluster (for advanced verification)

## 1. Environment Configuration Verification

First, verify that the Kafka Execution Logger is properly configured in your environment:

```bash
# Check if the Kafka logger is enabled
grep N8N_KAFKA_LOGGER_ENABLED .env

# Check if Kafka brokers are configured
grep N8N_KAFKA_LOGGER_BROKERS .env

# Check other Kafka-related configuration
grep N8N_KAFKA_LOGGER .env
```

### Required Configuration

At minimum, you need these environment variables set:

```
N8N_KAFKA_LOGGER_ENABLED=true
N8N_KAFKA_LOGGER_BROKERS=your-kafka-server:9092
```

Optional configuration:
```
N8N_KAFKA_LOGGER_TOPIC=your-topic-name  # Default: n8n-executions
N8N_KAFKA_LOGGER_CLIENT_ID=your-client-id  # Default: n8n-execution-logger
```

If using SSL/Authentication:
```
N8N_KAFKA_LOGGER_SSL=true
N8N_KAFKA_LOGGER_AUTH_ENABLED=true
N8N_KAFKA_LOGGER_USERNAME=your-username
N8N_KAFKA_LOGGER_PASSWORD=your-password
N8N_KAFKA_LOGGER_SASL_MECHANISM=plain  # or scram-sha-256, scram-sha-512
```

## 2. Log Verification

Check n8n logs for Kafka Execution Logger initialization messages:

```bash
# Check logs for Kafka initialization messages
grep "Kafka Execution Logger" /path/to/n8n/logs/n8n.log
```

### Successful Initialization

If the Kafka Execution Logger is successfully initialized, you should see these log messages:

```
Initializing Kafka Execution Logger...
Connected to Kafka successfully
Kafka Execution Logger initialized successfully
```

### Failed Initialization

If initialization fails, you might see error messages like:

```
Failed to initialize Kafka Execution Logger
Kafka Execution Logger is not configured. Set N8N_KAFKA_LOGGER_ENABLED=true and configure Kafka brokers to enable execution logging.
Failed to connect to Kafka, will retry later
```

## 3. Fallback Logs Check

If the Kafka Execution Logger can't connect to Kafka, it will log messages to a fallback location:

```bash
# Check if fallback logs directory exists
ls -la logs/kafka-fallback

# Check fallback logs content
cat logs/kafka-fallback/kafka-fallback.log
```

The presence of fallback logs indicates that the logger is active but having issues connecting to Kafka.

## 4. Runtime Verification

### Execute a Workflow

The most straightforward way to verify the logger is working is to execute a workflow and check if events are logged:

1. Create and execute a simple workflow in n8n
2. Check the logs for messages about sending events to Kafka:
   ```bash
   grep "Successfully sent" /path/to/n8n/logs/n8n.log
   ```

### Programmatic Verification

For advanced users, you can verify the status programmatically:

```typescript
// Get the Kafka Execution Logger service
const kafkaLoggerService = Container.get(KafkaExecutionLoggerIntegrationService);

// Check if it's enabled
const isEnabled = kafkaLoggerService.isEnabled();
console.log('Kafka Execution Logger enabled:', isEnabled);

// Get health metrics
const kafkaLogger = kafkaLoggerService.getKafkaExecutionLogger();
const healthMetrics = kafkaLogger.getHealthMetrics();
console.log('Health metrics:', healthMetrics);
```

## 5. Kafka Topic Verification

For direct verification, check the Kafka topic for messages:

```bash
# Using kafkacat/kcat to consume messages from the topic
kafkacat -b your-kafka-server:9092 -t n8n-executions -C

# Using Kafka CLI tools
kafka-console-consumer.sh --bootstrap-server your-kafka-server:9092 --topic n8n-executions --from-beginning
```

You should see JSON messages with workflow execution events in the Segment.com format:

```json
{
  "type": "track",
  "event": "Workflow Started",
  "userId": "user-id",
  "timestamp": "2023-07-24T08:30:00.000Z",
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "dimensions": {
    "execution_mode": "manual",
    "version": "1.0.0",
    "workflow_name": "My Workflow"
  },
  "flags": {
    "is_manual_execution": true,
    "is_retry": false
  },
  "metrics": {
    "node_count": 3,
    "duration_ms": 1500
  },
  "properties": {
    "started_at": "2023-07-24T08:29:58.500Z"
  }
}
```

## 6. Troubleshooting

If the Kafka Execution Logger is not working:

1. **Check Configuration**
   - Ensure both `N8N_KAFKA_LOGGER_ENABLED=true` and `N8N_KAFKA_LOGGER_BROKERS` are set
   - Verify Kafka credentials if authentication is enabled

2. **Verify Kafka Connectivity**
   - Test connectivity to Kafka from the n8n server:
     ```bash
     telnet your-kafka-server 9092
     ```

3. **Check Circuit Breaker Status**
   - If there are repeated connection failures, the circuit breaker might be open
   - Restart n8n to reset the circuit breaker

4. **Inspect Logs**
   - Look for specific error messages in the n8n logs
   - Check for authentication, network, or configuration errors

5. **Verify Kafka Topic**
   - Ensure the Kafka topic exists and is accessible
   - Check topic permissions if using ACLs

## 7. Common Issues

1. **No Kafka Brokers Configured**
   - Error: "Kafka Execution Logger is not configured"
   - Solution: Set `N8N_KAFKA_LOGGER_BROKERS=your-kafka-server:9092`

2. **Authentication Failures**
   - Error: "Authentication failed: SASL Authentication failed"
   - Solution: Verify username, password, and SASL mechanism

3. **Network Connectivity Issues**
   - Error: "Failed to connect to Kafka, will retry later"
   - Solution: Check network connectivity, firewall rules, and DNS resolution

4. **Topic Does Not Exist**
   - Error: "Topic n8n-executions does not exist"
   - Solution: Create the topic or set `N8N_KAFKA_LOGGER_TOPIC` to an existing topic

5. **SSL/TLS Issues**
   - Error: "SSL handshake failed"
   - Solution: Verify SSL configuration and certificates
