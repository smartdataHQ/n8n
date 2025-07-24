import type { INodeProperties } from 'n8n-workflow';

export const trackOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['track'],
			},
		},
		options: [
			{
				name: 'Event',
				value: 'event',
				description: 'Track an event',
				action: 'Track an event',
			},
			{
				name: 'Page',
				value: 'page',
				description: 'Track a page view',
				action: 'Track a page view',
			},
		],
		default: 'event',
	},
];

export const trackFields: INodeProperties[] = [
	/* -------------------------------------------------------------------------- */
	/*                                track:event                                 */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'User ID',
		name: 'userId',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['track'],
			},
		},
	},
	{
		displayName: 'Event',
		name: 'event',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['track'],
				operation: ['event'],
			},
		},
		description: 'Name of the event',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['track'],
				operation: ['page'],
			},
		},
		description: 'Name of the page',
	},
	{
		displayName: 'Properties',
		name: 'properties',
		placeholder: 'Add Property',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		displayOptions: {
			show: {
				resource: ['track'],
			},
		},
		default: {},
		options: [
			{
				name: 'propertiesUi',
				displayName: 'Property',
				values: [
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'Context',
		name: 'context',
		placeholder: 'Add Context',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				resource: ['track'],
			},
		},
		default: {},
		options: [
			{
				name: 'contextUi',
				displayName: 'Context',
				values: [
					{
						displayName: 'Active',
						name: 'active',
						type: 'boolean',
						default: false,
						description: 'Whether a user is active',
					},
					{
						displayName: 'IP',
						name: 'ip',
						type: 'string',
						default: '',
						description: 'Current user IP address',
					},
					{
						displayName: 'Locale',
						name: 'locate',
						type: 'string',
						default: '',
						description: 'Locale string for the current user, for example en-US',
					},
					{
						displayName: 'Page',
						name: 'page',
						type: 'string',
						default: '',
						description: 'Dictionary of information about the current page in the browser',
					},
					{
						displayName: 'Timezone',
						name: 'timezone',
						type: 'string',
						default: '',
						description: 'Timezones are sent as tzdata strings, for example America/New_York',
					},
				],
			},
		],
	},
	{
		displayName: 'Integrations',
		name: 'integrations',
		placeholder: 'Add Integration',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				resource: ['track'],
			},
		},
		default: {},
		options: [
			{
				name: 'integrationsUi',
				displayName: 'Integration',
				values: [
					{
						displayName: 'All',
						name: 'all',
						type: 'boolean',
						default: true,
						description: 'Enable/disable all integrations at once',
					},
					{
						displayName: 'Salesforce',
						name: 'salesforce',
						type: 'boolean',
						default: true,
						description: 'Enable/disable Salesforce integration',
					},
				],
			},
		],
	},
];
