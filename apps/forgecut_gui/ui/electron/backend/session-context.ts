import type { EditingContext } from "../shared/ipc-contract.js";

type ContextValues = Omit<EditingContext, "sessionId">;

export class SessionContext {
  private value: ContextValues = {
    contextRevision: 0,
    selectedItemIds: [],
    selectedLayerIds: [],
    playheadUs: 0,
  };

  snapshot(): ContextValues {
    return structuredClone(this.value);
  }

  update(
    selectedItemIds: string[],
    playheadUs: number,
    selectedLayerIds: string[] = [],
  ): void {
    const layers = [...new Set(selectedLayerIds)];
    const selection = [...new Set(selectedItemIds)];
    if (
      JSON.stringify(selection) ===
        JSON.stringify(this.value.selectedItemIds) &&
      JSON.stringify(layers) === JSON.stringify(this.value.selectedLayerIds) &&
      playheadUs === this.value.playheadUs
    )
      return;
    this.value = {
      contextRevision: this.value.contextRevision + 1,
      selectedItemIds: selection,
      selectedLayerIds: layers,
      playheadUs,
    };
  }

  reconcile(itemIds: Set<string>, layerIds: Set<string>): void {
    this.update(
      this.value.selectedItemIds.filter((id) => itemIds.has(id)),
      this.value.playheadUs,
      this.value.selectedLayerIds.filter((id) => layerIds.has(id)),
    );
  }

  clear(): void {
    this.value = {
      contextRevision: this.value.contextRevision + 1,
      selectedItemIds: [],
      selectedLayerIds: [],
      playheadUs: 0,
    };
  }
}
