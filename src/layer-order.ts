export type LayerDirection = "front" | "back" | "forward" | "backward";

export interface CanvasNodeData {
	id: string;
	[key: string]: unknown;
}

export interface CanvasData {
	nodes?: CanvasNodeData[];
	edges?: unknown[];
	[key: string]: unknown;
}

export function reorderCanvasNode(data: CanvasData, nodeId: string, direction: LayerDirection): boolean {
	const nodes = data.nodes;
	if (!Array.isArray(nodes)) {
		return false;
	}

	const currentIndex = nodes.findIndex((node) => node.id === nodeId);
	if (currentIndex === -1) {
		return false;
	}

	let targetIndex = currentIndex;
	if (direction === "front") {
		targetIndex = nodes.length - 1;
	} else if (direction === "back") {
		targetIndex = 0;
	} else if (direction === "forward") {
		targetIndex = Math.min(nodes.length - 1, currentIndex + 1);
	} else if (direction === "backward") {
		targetIndex = Math.max(0, currentIndex - 1);
	}

	if (targetIndex === currentIndex) {
		return false;
	}

	const [node] = nodes.splice(currentIndex, 1);
	nodes.splice(targetIndex, 0, node);
	return true;
}
