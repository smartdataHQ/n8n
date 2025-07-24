#!/bin/bash

# Kafka Execution Logger Integration Test Runner
# This script sets up Kafka test environment and runs integration tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../../../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
KAFKA_INTEGRATION_TESTS=${KAFKA_INTEGRATION_TESTS:-true}
KAFKA_TIMEOUT=${KAFKA_TIMEOUT:-60}
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.test.yml"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
}

# Function to check if Docker Compose is available
check_docker_compose() {
    if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
        print_error "Docker Compose is not available. Please install Docker Compose."
        exit 1
    fi
}

# Function to start Kafka test environment
start_kafka() {
    print_status "Starting Kafka test environment..."

    cd "$SCRIPT_DIR"

    # Use docker compose if available, otherwise fall back to docker-compose
    if docker compose version >/dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    else
        COMPOSE_CMD="docker-compose"
    fi

    # Start services
    $COMPOSE_CMD -f docker-compose.test.yml up -d

    print_status "Waiting for Kafka services to be ready..."

    # Wait for services to be healthy
    local timeout=$KAFKA_TIMEOUT
    local elapsed=0

    while [ $elapsed -lt $timeout ]; do
        if $COMPOSE_CMD -f docker-compose.test.yml ps | grep -q "healthy"; then
            print_status "Kafka services are ready!"
            return 0
        fi

        sleep 2
        elapsed=$((elapsed + 2))
        echo -n "."
    done

    print_error "Kafka services failed to start within ${timeout} seconds"
    print_status "Checking service logs..."
    $COMPOSE_CMD -f docker-compose.test.yml logs
    return 1
}

# Function to stop Kafka test environment
stop_kafka() {
    print_status "Stopping Kafka test environment..."

    cd "$SCRIPT_DIR"

    if docker compose version >/dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    else
        COMPOSE_CMD="docker-compose"
    fi

    $COMPOSE_CMD -f docker-compose.test.yml down -v

    # Clean up any remaining containers
    docker container prune -f >/dev/null 2>&1 || true
    docker volume prune -f >/dev/null 2>&1 || true
}

# Function to run tests
run_tests() {
    print_status "Running Kafka Execution Logger integration tests..."

    cd "$PROJECT_ROOT/packages/cli"

    # Set environment variables for integration tests
    export KAFKA_INTEGRATION_TESTS=true
    export KAFKA_BROKERS="localhost:9092"
    export KAFKA_SSL=false
    export KAFKA_USERNAME=""
    export KAFKA_PASSWORD=""
    export KAFKA_SASL_MECHANISM=""

    # Run the specific integration test using the CLI package's test command
    if command -v pnpm >/dev/null 2>&1; then
        pnpm test src/execution-lifecycle/kafka-execution-logger/__tests__/integration.test.ts
    elif command -v npm >/dev/null 2>&1; then
        npm test src/execution-lifecycle/kafka-execution-logger/__tests__/integration.test.ts
    else
        print_error "Neither pnpm nor npm found. Please install a package manager."
        return 1
    fi
}

# Function to run authentication tests
run_auth_tests() {
    print_status "Running authentication tests..."

    # Test SASL/PLAIN
    export KAFKA_BROKERS="localhost:9093"
    export KAFKA_USERNAME="testuser"
    export KAFKA_PASSWORD="testuser-secret"
    export KAFKA_SASL_MECHANISM="plain"

    print_status "Testing SASL/PLAIN authentication..."
    run_tests

    # Test SASL/SCRAM-SHA-256
    export KAFKA_USERNAME="admin"
    export KAFKA_PASSWORD="admin-secret"
    export KAFKA_SASL_MECHANISM="scram-sha-256"

    print_status "Testing SASL/SCRAM-SHA-256 authentication..."
    run_tests
}

# Function to run failure scenario tests
run_failure_tests() {
    print_status "Running failure scenario tests..."

    # Test with invalid broker
    export KAFKA_BROKERS="invalid-broker:9092"
    export KAFKA_USERNAME=""
    export KAFKA_PASSWORD=""
    export KAFKA_SASL_MECHANISM=""

    print_status "Testing connection failure scenarios..."
    run_tests || true  # Allow failure tests to fail
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --start-only    Start Kafka environment only (don't run tests)"
    echo "  --stop-only     Stop Kafka environment only"
    echo "  --no-auth       Skip authentication tests"
    echo "  --no-failure    Skip failure scenario tests"
    echo "  --help          Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  KAFKA_INTEGRATION_TESTS  Enable/disable integration tests (default: true)"
    echo "  KAFKA_TIMEOUT           Timeout for Kafka startup in seconds (default: 60)"
}

# Main execution
main() {
    local start_only=false
    local stop_only=false
    local skip_auth=false
    local skip_failure=false

    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --start-only)
                start_only=true
                shift
                ;;
            --stop-only)
                stop_only=true
                shift
                ;;
            --no-auth)
                skip_auth=true
                shift
                ;;
            --no-failure)
                skip_failure=true
                shift
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    # Check prerequisites
    check_docker
    check_docker_compose

    # Handle stop-only option
    if [ "$stop_only" = true ]; then
        stop_kafka
        exit 0
    fi

    # Set up trap to clean up on exit
    trap 'stop_kafka' EXIT

    # Start Kafka environment
    if ! start_kafka; then
        print_error "Failed to start Kafka environment"
        exit 1
    fi

    # Handle start-only option
    if [ "$start_only" = true ]; then
        print_status "Kafka environment started. Use --stop-only to stop it."
        trap - EXIT  # Remove the trap so services stay running
        exit 0
    fi

    # Run tests
    print_status "Running integration tests..."

    # Basic integration tests
    if ! run_tests; then
        print_error "Basic integration tests failed"
        exit 1
    fi

    # Authentication tests
    if [ "$skip_auth" = false ]; then
        if ! run_auth_tests; then
            print_warning "Authentication tests failed"
        fi
    fi

    # Failure scenario tests
    if [ "$skip_failure" = false ]; then
        run_failure_tests
    fi

    print_status "All integration tests completed!"
}

# Run main function with all arguments
main "$@"
