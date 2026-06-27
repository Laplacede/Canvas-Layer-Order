import {
	App,
	EventRef,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf
} from "obsidian";
import { CanvasData, LayerDirection, reorderCanvasNode } from "./layer-order";

interface CanvasLayerOrderSettings {
	preserveLayerOrderOnFocus: boolean;
}

const DEFAULT_SETTINGS: CanvasLayerOrderSettings = {
	preserveLayerOrderOnFocus: false
};

type CanvasNodeLike = {
	id?: string;
	node?: { id?: string };
	data?: { id?: string };
	child?: { id?: string };
	containerEl?: HTMLElement;
	nodeEl?: HTMLElement;
};

type CanvasNodesLike = Map<string, CanvasNodeLike> | Record<string, CanvasNodeLike>;

type CanvasViewLike = {
	file?: TFile;
	containerEl?: HTMLElement;
	canvas?: {
		nodes?: CanvasNodesLike;
		selection?: Set<CanvasNodeLike> | CanvasNodeLike[];
		selectionManager?: { selected?: Set<CanvasNodeLike> | CanvasNodeLike[] };
		wrapperEl?: HTMLElement;
		containerEl?: HTMLElement;
	};
	getViewType?: () => string;
};

export default class CanvasLayerOrderPlugin extends Plugin {
	settings: CanvasLayerOrderSettings = DEFAULT_SETTINGS;
	private observer: MutationObserver | null = null;
	private syncFrame: number | null = null;
	private syncTimeouts: number[] = [];

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "bring-to-front",
			name: "Canvas: Bring selected card to front",
			callback: () => this.reorderSelectedNode("front")
		});

		this.addCommand({
			id: "send-to-back",
			name: "Canvas: Send selected card to back",
			callback: () => this.reorderSelectedNode("back")
		});

		this.addCommand({
			id: "bring-forward",
			name: "Canvas: Bring selected card forward",
			callback: () => this.reorderSelectedNode("forward")
		});

		this.addCommand({
			id: "send-backward",
			name: "Canvas: Send selected card backward",
			callback: () => this.reorderSelectedNode("backward")
		});

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.installLayerObserver())
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.installLayerObserver())
		);
		this.registerEvent(
			(this.app.workspace as unknown as {
				on(name: "canvas:node-menu", callback: (menu: Menu, node: CanvasNodeLike) => void): EventRef;
			}).on("canvas:node-menu", (menu, node) => this.addLayerMenuItems(menu, node))
		);

		this.registerDomEvent(document, "selectionchange", () => this.scheduleLayerSync());
		this.registerDomEvent(document, "pointerdown", () => this.scheduleLayerSyncBurst());
		this.registerDomEvent(document, "click", () => this.scheduleLayerSyncBurst());
		this.registerDomEvent(document, "focusin", () => this.scheduleLayerSyncBurst());
		this.addSettingTab(new CanvasLayerOrderSettingTab(this.app, this));
		this.installLayerObserver();
	}

	onunload() {
		this.observer?.disconnect();
		if (this.syncFrame !== null) {
			cancelAnimationFrame(this.syncFrame);
		}
		this.clearSyncTimeouts();
		this.clearDomLayerOrder();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.installLayerObserver();
		this.scheduleLayerSync();
	}

	private async reorderSelectedNode(direction: LayerDirection) {
		const view = this.getActiveCanvasView();
		if (!view?.file) {
			new Notice("Open a Canvas file first.");
			return;
		}

		const nodeId = this.getSelectedNodeId(view);
		if (!nodeId) {
			new Notice("Select one Canvas card first.");
			return;
		}

		await this.reorderNode(view, nodeId, direction);
	}

	private async reorderNode(view: CanvasViewLike, nodeId: string, direction: LayerDirection) {
		if (!view.file) {
			new Notice("Open a Canvas file first.");
			return;
		}

		let data: CanvasData;
		try {
			data = JSON.parse(await this.app.vault.read(view.file)) as CanvasData;
		} catch {
			new Notice("Could not read this Canvas file.");
			return;
		}

		const changed = reorderCanvasNode(data, nodeId, direction);
		if (!changed) {
			new Notice("That card is already at this layer boundary.");
			return;
		}

		await this.app.vault.modify(view.file, JSON.stringify(data, null, "\t"));
		this.scheduleLayerSync();
		new Notice(this.noticeFor(direction));
	}

	private addLayerMenuItems(menu: Menu, node: CanvasNodeLike) {
		const nodeId = this.nodeIdFromUnknown(node);
		if (!nodeId) {
			return;
		}

		const view = this.getActiveCanvasView();
		if (!view?.file) {
			return;
		}

		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle("Bring to front")
				.setIcon("bring-to-front")
				.onClick(() => this.reorderNode(view, nodeId, "front"));
		});
		menu.addItem((item) => {
			item.setTitle("Bring forward")
				.setIcon("chevrons-up")
				.onClick(() => this.reorderNode(view, nodeId, "forward"));
		});
		menu.addItem((item) => {
			item.setTitle("Send backward")
				.setIcon("chevrons-down")
				.onClick(() => this.reorderNode(view, nodeId, "backward"));
		});
		menu.addItem((item) => {
			item.setTitle("Send to back")
				.setIcon("send-to-back")
				.onClick(() => this.reorderNode(view, nodeId, "back"));
		});
	}

	private getActiveCanvasView(): CanvasViewLike | null {
		const leaf = this.app.workspace.activeLeaf as WorkspaceLeaf | null;
		const view = leaf?.view as CanvasViewLike | undefined;
		return view?.getViewType?.() === "canvas" ? view : null;
	}

	private getSelectedNodeId(view: CanvasViewLike): string | null {
		const canvas = view.canvas;
		const selection = canvas?.selection ?? canvas?.selectionManager?.selected;
		const selected = selection instanceof Set ? Array.from(selection) : Array.isArray(selection) ? selection : [];

		for (const item of selected) {
			const id = this.nodeIdFromUnknown(item);
			if (id) {
				return id;
			}
		}

		const activeElement = document.activeElement as HTMLElement | null;
		const activeNode = activeElement?.closest?.("[data-node-id], .canvas-node") as HTMLElement | null;
		return activeNode ? this.nodeIdFromElement(activeNode, canvas?.nodes) : null;
	}

	private nodeIdFromUnknown(item: CanvasNodeLike | null | undefined): string | null {
		return item?.id ?? item?.node?.id ?? item?.data?.id ?? item?.child?.id ?? null;
	}

	private installLayerObserver() {
		this.observer?.disconnect();
		this.observer = null;

		const view = this.getActiveCanvasView();
		if (!this.settings.preserveLayerOrderOnFocus) {
			this.clearDomLayerOrder(view);
			return;
		}

		const root = this.getCanvasRoot(view);
		if (!root) {
			return;
		}

		this.observer = new MutationObserver(() => this.scheduleLayerSync());
		this.observer.observe(root, {
			attributes: true,
			attributeFilter: ["class", "style"],
			childList: true,
			subtree: true
		});
		this.scheduleLayerSyncBurst();
	}

	private scheduleLayerSyncBurst() {
		if (!this.settings.preserveLayerOrderOnFocus) {
			return;
		}

		this.scheduleLayerSync();
		this.clearSyncTimeouts();
		for (const delay of [20, 80, 180, 360]) {
			const timeout = window.setTimeout(() => this.scheduleLayerSync(), delay);
			this.syncTimeouts.push(timeout);
		}
	}

	private scheduleLayerSync() {
		if (!this.settings.preserveLayerOrderOnFocus || this.syncFrame !== null) {
			return;
		}

		this.syncFrame = requestAnimationFrame(async () => {
			this.syncFrame = null;
			await this.syncDomLayerOrder();
		});
	}

	private clearSyncTimeouts() {
		for (const timeout of this.syncTimeouts) {
			window.clearTimeout(timeout);
		}
		this.syncTimeouts = [];
	}

	private async syncDomLayerOrder() {
		const view = this.getActiveCanvasView();
		if (!view?.file || !view.canvas) {
			return;
		}

		let data: CanvasData;
		try {
			data = JSON.parse(await this.app.vault.read(view.file)) as CanvasData;
		} catch {
			return;
		}

		if (!Array.isArray(data.nodes)) {
			return;
		}

		data.nodes.forEach((node, index) => {
			for (const element of this.findNodeElements(view, node.id)) {
				this.setLayerZIndex(element, index + 1);
			}
		});
	}

	private clearDomLayerOrder(view: CanvasViewLike | null = this.getActiveCanvasView()) {
		const root = this.getCanvasRoot(view) ?? document;
		root.querySelectorAll<HTMLElement>("[data-canvas-layer-order-z-index]").forEach((element) => {
			element.style.removeProperty("z-index");
			element.removeAttribute("data-canvas-layer-order-z-index");
		});
	}

	private getCanvasRoot(view: CanvasViewLike | null): HTMLElement | null {
		return view?.canvas?.wrapperEl ?? view?.canvas?.containerEl ?? view?.containerEl ?? null;
	}

	private findNodeElements(view: CanvasViewLike, nodeId: string): HTMLElement[] {
		const elements = new Set<HTMLElement>();
		const nodes = view.canvas?.nodes;
		const node = nodes instanceof Map ? nodes.get(nodeId) : nodes?.[nodeId];
		const directElement = node?.containerEl ?? node?.nodeEl;
		if (directElement) {
			elements.add(directElement);
			const canvasNode = directElement.closest<HTMLElement>(".canvas-node");
			if (canvasNode) {
				elements.add(canvasNode);
			}
		}

		const escaped = this.escapeCss(nodeId);
		document
			.querySelectorAll<HTMLElement>(`[data-node-id="${escaped}"], .canvas-node[data-id="${escaped}"]`)
			.forEach((element) => {
				elements.add(element);
				const canvasNode = element.closest<HTMLElement>(".canvas-node");
				if (canvasNode) {
					elements.add(canvasNode);
				}
			});

		return Array.from(elements);
	}

	private setLayerZIndex(element: HTMLElement, zIndex: number) {
		const value = String(zIndex);
		if (
			element.style.getPropertyValue("z-index") === value &&
			element.style.getPropertyPriority("z-index") === "important"
		) {
			return;
		}

		element.style.setProperty("z-index", value, "important");
		element.setAttribute("data-canvas-layer-order-z-index", value);
	}

	private nodeIdFromElement(element: HTMLElement, nodes?: CanvasNodesLike): string | null {
		const dataId = element.getAttribute("data-node-id") ?? element.getAttribute("data-id");
		if (dataId) {
			return dataId;
		}

		if (nodes instanceof Map) {
			for (const [id, node] of nodes) {
				if (node.containerEl === element || node.nodeEl === element) {
					return id;
				}
			}
		}

		return null;
	}

	private escapeCss(value: string): string {
		return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
	}

	private noticeFor(direction: LayerDirection): string {
		if (direction === "front") {
			return "Brought card to front.";
		}
		if (direction === "back") {
			return "Sent card to back.";
		}
		if (direction === "forward") {
			return "Brought card forward.";
		}
		return "Sent card backward.";
	}
}

class CanvasLayerOrderSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: CanvasLayerOrderPlugin) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Canvas Layer Order" });

		new Setting(containerEl)
			.setName("Preserve layer order when focusing cards")
			.setDesc("When enabled, focusing a Canvas card will not visually lift it above cards that are later in the Canvas file.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.preserveLayerOrderOnFocus)
					.onChange(async (value) => {
						this.plugin.settings.preserveLayerOrderOnFocus = value;
						await this.plugin.saveSettings();
					});
			});

		containerEl.createDiv({
			cls: "canvas-layer-order-status",
			text: "Layer commands use the selected card's position in the Canvas nodes array: later nodes render above earlier nodes."
		});
	}
}
