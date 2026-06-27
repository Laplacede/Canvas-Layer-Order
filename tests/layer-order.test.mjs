import assert from "node:assert/strict";

function reorderCanvasNode(data, nodeId, direction) {
	const nodes = data.nodes;
	if (!Array.isArray(nodes)) return false;
	const currentIndex = nodes.findIndex((node) => node.id === nodeId);
	if (currentIndex === -1) return false;

	let targetIndex = currentIndex;
	if (direction === "front") targetIndex = nodes.length - 1;
	else if (direction === "back") targetIndex = 0;
	else if (direction === "forward") targetIndex = Math.min(nodes.length - 1, currentIndex + 1);
	else if (direction === "backward") targetIndex = Math.max(0, currentIndex - 1);

	if (targetIndex === currentIndex) return false;
	const [node] = nodes.splice(currentIndex, 1);
	nodes.splice(targetIndex, 0, node);
	return true;
}

const ids = (data) => data.nodes.map((node) => node.id);

{
	const data = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] };
	assert.equal(reorderCanvasNode(data, "a", "front"), true);
	assert.deepEqual(ids(data), ["b", "c", "a"]);
}

{
	const data = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] };
	assert.equal(reorderCanvasNode(data, "c", "back"), true);
	assert.deepEqual(ids(data), ["c", "a", "b"]);
}

{
	const data = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] };
	assert.equal(reorderCanvasNode(data, "b", "forward"), true);
	assert.deepEqual(ids(data), ["a", "c", "b"]);
}

{
	const data = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] };
	assert.equal(reorderCanvasNode(data, "b", "backward"), true);
	assert.deepEqual(ids(data), ["b", "a", "c"]);
}

{
	const data = { nodes: [{ id: "a" }] };
	assert.equal(reorderCanvasNode(data, "a", "front"), false);
	assert.deepEqual(ids(data), ["a"]);
}

console.log("layer-order tests passed");
