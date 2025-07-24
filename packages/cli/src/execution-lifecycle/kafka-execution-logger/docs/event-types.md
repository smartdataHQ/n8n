# Event Types in kafka-execution-logger

The kafka-execution-logger component sends workflow execution events to Kafka using a format inspired by [Segment.com's track events](https://segment.com/docs/connections/spec/track/). This document explains the event types and their structure.

## Event Format Overview

All events sent by the kafka-execution-logger follow this general structure:

```json
{
  "type": "track",
  "event": "<Event Name>",
  "userId": "<User ID>",
  "anonymousId": "<Anonymous ID if no userId>",
  "timestamp": "<ISO 8601 timestamp>",
  "messageId": "<UUID>",
  "dimensions": {
    "execution_mode": "<Execution Mode>",
    "version": "<n8n Version>",
    "environment": "<Environment>",
    "trigger_type": "<Trigger Type>",
    "workflow_name": "<Workflow Name>",
    "status": "<Status>"
  },
  "flags": {
    "is_manual_execution": "<Boolean>",
    "is_retry": "<Boolean>"
  },
  "metrics": {
    "node_count": "<Number>",
    "duration_ms": "<Number>"
  },
  "properties": {
    "trigger_node": "<Trigger Node Name>",
    "retry_of": "<Execution ID of original execution if retry>",
    "started_at": "<ISO 8601 timestamp>",
    "finished_at": "<ISO 8601 timestamp>",
    "workflow_version": "<Workflow Version>"
  }
}
```

## Event Types

The kafka-execution-logger sends different event types based on the workflow execution status. The `type` field is always set to `"track"` for all events, while the `event` field contains the specific event name.

### Workflow Started

When a workflow execution starts:

- `type`: "track"
- `event`: "Workflow Started"

### Workflow Completed

When a workflow execution completes successfully:

- `type`: "track"
- `event`: "Workflow Completed"
- `dimensions.status`: "success"

### Workflow Failed

When a workflow execution fails with an error:

- `type`: "track"
- `event`: "Workflow Failed"
- `dimensions.status`: "error"
- Additional error information in `properties` and `dimensions`

### Workflow Cancelled

When a workflow execution is terminated/cancelled:

- `type`: "track"
- `event`: "Workflow Cancelled"
- `dimensions.status`: "cancelled"

## Status Mapping

The n8n workflow status is mapped to standardized status values:

| n8n Status | Mapped Status |
|------------|---------------|
| success    | success       |
| error      | error         |
| canceled   | cancelled     |
| cancelled  | cancelled     |
| crashed    | error         |
| waiting    | waiting       |
| running    | running       |

## Examples

### Example: Workflow Cancelled Event

```json
{
  "type": "track",
  "event": "Workflow Cancelled",
  "userId": "user-123",
  "timestamp": "2023-07-24T08:30:00.000Z",
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "dimensions": {
    "execution_mode": "manual",
    "version": "1.0.0",
    "environment": "production",
    "trigger_type": "manual",
    "workflow_name": "My Workflow",
    "status": "cancelled"
  },
  "metrics": {
    "node_count": 5,
    "duration_ms": 1500
  },
  "properties": {
    "started_at": "2023-07-24T08:29:58.500Z",
    "finished_at": "2023-07-24T08:30:00.000Z"
  }
}
```

## Handling Events in Consumers

When consuming these events from Kafka, you can identify the event type by checking:

1. The `event` field for the specific event name ("Workflow Started", "Workflow Completed", "Workflow Failed", or "Workflow Cancelled")
2. The `dimensions.status` field for the status ("success", "error", "cancelled", etc.)

For terminated/cancelled workflows, look for events where:
- `event` is "Workflow Cancelled"
- `dimensions.status` is "cancelled"
