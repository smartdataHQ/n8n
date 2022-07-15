<template>
	<div>
		<div class="node-icon-wrapper" :style="iconStyleData">
			<div v-if="type !== unknown" class="icon">
				<img v-if="type === 'file'" :src="path" :style="imageStyleData" />
				<font-awesome-icon v-else :icon="path" :style="fontStyleData" />
			</div>
			<div v-else class="node-icon-placeholder">
				{{ nodeTypeName !== null ? nodeTypeName.charAt(0) : '?' }}
				?
			</div>
		</div>
	</div>
</template>

<script lang="ts">
import Vue from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';

export default Vue.extend({
	name: 'n8n-node-icon',
	components: {
		FontAwesomeIcon,
	},
	props: {
		type: {
			type: String,
			required: true,
			validator: (value: string): boolean =>
				['file', 'fontIcon', 'unknown'].includes(value),
		},
		path: {
			type: String,
			required: true,
		},
		nodeTypeName: {
			type: String,
			required: false,
		},
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
		iconStyleData (): object {
			if(!this.size) {
				return {
					color: this.color || '',
				};
			}
			return {
				color: this.color || '',
				width: `${this.size}px`,
				height: `${this.size}px`,
				'font-size': `${this.size}px`,
				'line-height': `${this.size}px`,
				'border-radius': this.circle ? '50%': '2px',
				...(this.disabled && {
					color: '#ccc', // TODO: extract or var
					'-webkit-filter': 'contrast(40%) brightness(1.5) grayscale(100%)',
					'filter': 'contrast(40%) brightness(1.5) grayscale(100%)',
				}),
			}
		},
		imageStyleData (): object { // TODO: To css
			return {
				width: '100%',
				'max-width': '100%',
				'max-height': '100%',
			};
		},
		fontStyleData (): object {
			return {
				'max-width': `${this.size}px`,
			};
		},
	}
});
</script>

<style lang="scss" module>
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
}

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
</style>
