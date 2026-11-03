import type {Instruction} from '../trazos';

export type ShapeInfo = {
	path: string;
	width: number;
	height: number;
	transformOrigin: string;
	instructions: Instruction[];
};
