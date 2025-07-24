import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { v4 as uuid } from 'uuid';

import { contextSuiteApiRequest } from './GenericFunctions';
import { groupFields, groupOperations } from './GroupDescription';
import { identifyFields, identifyOperations } from './IdentifyDescription';
import type { IIdentify } from './IdentifyInterface';
import { trackFields, trackOperations } from './TrackDescription';
import type { IGroup, ITrack } from './TrackInterface';

export class ContextSuite implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Context Suite',
		name: 'contextSuite',
		icon: 'file:contextsuite.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ":" + $parameter["resource"]}}',
		description: 'Consume Context Suite API',
		defaults: {
			name: 'Context Suite',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'contextSuiteApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Group',
						value: 'group',
						description: 'Group lets you associate an identified user with a group',
					},
					{
						name: 'Identify',
						value: 'identify',
						description: 'Identify lets you tie a user to their actions',
					},
					{
						name: 'Track',
						value: 'track',
						description: 'Track lets you record events',
					},
				],
				default: 'identify',
			},
			...groupOperations,
			...groupFields,
			...identifyOperations,
			...trackOperations,
			...identifyFields,
			...trackFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];
		const length = items.length;
		let responseData;
		const resource = this.getNodeParameter('resource', 0);
		const operation = this.getNodeParameter('operation', 0);

		for (let i = 0; i < length; i++) {
			try {
				if (resource === 'group') {
					if (operation === 'add') {
						const userId = this.getNodeParameter('userId', i) as string;
						const groupId = this.getNodeParameter('groupId', i) as string;
						const traits = (this.getNodeParameter('traits', i) as IDataObject)
							.traitsUi as IDataObject[];
						const context = (this.getNodeParameter('context', i) as IDataObject)
							.contextUi as IDataObject;
						const integrations = (this.getNodeParameter('integrations', i) as IDataObject)
							.integrationsUi as IDataObject;

						const body: IGroup = {
							groupId,
							traits: {},
							context: {},
							integrations: {},
						};

						if (userId) {
							body.userId = userId;
						} else {
							body.anonymousId = uuid();
						}

						if (traits && traits.length !== 0) {
							for (const trait of traits) {
								body.traits![trait.key as string] = trait.value;
							}
						}

						if (context) {
							body.context = context;
						}

						if (integrations) {
							body.integrations = integrations;
						}

						responseData = await contextSuiteApiRequest.call(this, 'POST', '/group', body);
					}
				}

				if (resource === 'identify') {
					if (operation === 'create') {
						const userId = this.getNodeParameter('userId', i) as string;
						const traits = (this.getNodeParameter('traits', i) as IDataObject)
							.traitsUi as IDataObject[];
						const context = (this.getNodeParameter('context', i) as IDataObject)
							.contextUi as IDataObject;
						const integrations = (this.getNodeParameter('integrations', i) as IDataObject)
							.integrationsUi as IDataObject;

						const body: IIdentify = {
							traits: {},
							context: {},
							integrations: {},
						};

						if (userId) {
							body.userId = userId;
						} else {
							body.anonymousId = uuid();
						}

						if (traits && traits.length !== 0) {
							for (const trait of traits) {
								body.traits![trait.key as string] = trait.value;
							}
						}

						if (context) {
							body.context = context;
						}

						if (integrations) {
							body.integrations = integrations;
						}

						responseData = await contextSuiteApiRequest.call(this, 'POST', '/identify', body);
					}
				}

				if (resource === 'track') {
					if (operation === 'event') {
						const userId = this.getNodeParameter('userId', i) as string;
						const event = this.getNodeParameter('event', i) as string;
						const properties = (this.getNodeParameter('properties', i) as IDataObject)
							.propertiesUi as IDataObject[];
						const context = (this.getNodeParameter('context', i) as IDataObject)
							.contextUi as IDataObject;
						const integrations = (this.getNodeParameter('integrations', i) as IDataObject)
							.integrationsUi as IDataObject;

						const body: ITrack = {
							event,
							properties: {},
							context: {},
							integrations: {},
						};

						if (userId) {
							body.userId = userId;
						} else {
							body.anonymousId = uuid();
						}

						if (properties && properties.length !== 0) {
							for (const property of properties) {
								body.properties![property.key as string] = property.value;
							}
						}

						if (context) {
							body.context = context;
						}

						if (integrations) {
							body.integrations = integrations;
						}

						responseData = await contextSuiteApiRequest.call(this, 'POST', '/track', body);
					}

					if (operation === 'page') {
						const userId = this.getNodeParameter('userId', i) as string;
						const name = this.getNodeParameter('name', i) as string;
						const properties = (this.getNodeParameter('properties', i) as IDataObject)
							.propertiesUi as IDataObject[];
						const context = (this.getNodeParameter('context', i) as IDataObject)
							.contextUi as IDataObject;
						const integrations = (this.getNodeParameter('integrations', i) as IDataObject)
							.integrationsUi as IDataObject;

						const body: ITrack = {
							name,
							properties: {},
							context: {},
							integrations: {},
						};

						if (userId) {
							body.userId = userId;
						} else {
							body.anonymousId = uuid();
						}

						if (properties && properties.length !== 0) {
							for (const property of properties) {
								body.properties![property.key as string] = property.value;
							}
						}

						if (context) {
							body.context = context;
						}

						if (integrations) {
							body.integrations = integrations;
						}

						responseData = await contextSuiteApiRequest.call(this, 'POST', '/page', body);
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ error: error.message });
					continue;
				}
				throw error;
			}

			if (Array.isArray(responseData)) {
				returnData.push.apply(returnData, responseData as IDataObject[]);
			} else {
				returnData.push(responseData as IDataObject);
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}
