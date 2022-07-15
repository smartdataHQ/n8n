<template>
	<n8n-node-icon type="fontIcon" path="cogs" :size="200"></n8n-node-icon>
</template>

<script lang="ts">

import { IVersionNode } from '@/Interface';
import { INodeTypeDescription } from 'n8n-workflow';
import Vue from 'vue';

interface NodeIconData {
	type: string;
	path?: string;
	fileExtension?: string;
	fileBuffer?: string;
}

export default Vue.extend({
	name: 'NodeIcon',
	props: {
		nodeType: {},
		size: {
			type: Number,
		},
		disabled: {
			type: Boolean,
			default: false,
		},
		circle: {
			type: Boolean,
			default: false,
		},
	},
	computed: {
		nodeIconData (): null | NodeIconData {
			const nodeType = this.nodeType as INodeTypeDescription | IVersionNode | null;
			if (nodeType === null) {
				return null;
			}

			if ((nodeType as IVersionNode).iconData) {
				return (nodeType as IVersionNode).iconData;
			}

			const restUrl = this.$store.getters.getRestUrl;

			if (nodeType.icon) {
				let type, path;
				[type, path] = nodeType.icon.split(':');
				const returnData: NodeIconData = {
					type,
					path,
				};

				if (type === 'file') {
					returnData.path = restUrl + '/node-icon/' + nodeType.name;
					returnData.fileExtension = path.split('.').slice(-1).join();
				}

				return returnData;
			}
			return null;
		},
	},
});
</script>

<style lang="scss">

.node-icon-wrapper {
	width: 26px;
	height: 26px;
	border-radius: 2px;
	color: #444;
	line-height: 26px;
	font-size: 1.1em;
	overflow: hidden;
	text-align: center;
	font-weight: bold;
	font-size: 20px;

	.icon {
		height: 100%;
		width: 100%;

		display: flex;
		justify-content: center;
		align-items: center;
	}

	.node-icon-placeholder {
		text-align: center;
	}
}

</style>
