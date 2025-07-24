# Configuring Kafka Connection for kafka-execution-logger

The kafka-execution-logger component already supports configuration through environment variables. Here's how to configure the Kafka connection:

## Basic Configuration

```
# Enable the Kafka logger
N8N_KAFKA_LOGGER_ENABLED=true

# Configure Kafka brokers (comma-separated list)
N8N_KAFKA_LOGGER_BROKERS=your-kafka-server:9092

# Set the Kafka topic (optional, default: n8n-executions)
N8N_KAFKA_LOGGER_TOPIC=your-topic-name

# Set the client ID (optional, default: n8n-execution-logger)
N8N_KAFKA_LOGGER_CLIENT_ID=your-client-id
```

## SSL/TLS Configuration

```
# Enable SSL
N8N_KAFKA_LOGGER_SSL=true
```

## Authentication Configuration

```
# Enable authentication
N8N_KAFKA_LOGGER_AUTH_ENABLED=true

# Set username and password
N8N_KAFKA_LOGGER_USERNAME=your-username
N8N_KAFKA_LOGGER_PASSWORD=your-password

# Set SASL mechanism (optional, default: plain)
# Valid values: plain, scram-sha-256, scram-sha-512
N8N_KAFKA_LOGGER_SASL_MECHANISM=plain
```

These environment variables can be set in your `.env` file, Docker Compose configuration, or directly in your environment before starting n8n.
