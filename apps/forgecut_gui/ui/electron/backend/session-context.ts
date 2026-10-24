import type { EditingContext } from "../shared/ipc-contract.js";

type ContextValues = Omit<EditingContext, "sessionId">;

export class SessionContext {
  private value: ContextValues = {
    contextRevision: 0,
    selectedItemIds: [],
    selectedLayerIds: [],
    playheadUs: 0,
  };

  private readonly sequences = new Map<
    string,
    Omit<ContextValues, "contextRevision" | "activeSequenceId">
  >();

  sequenceRevision = 0;

  selectSequence(sequenceId: string): boolean {
    if (this.value.activeSequenceId === sequenceId) return false;
    const previous = this.value.activeSequenceId;
    if (previous) {
      this.sequences.set(previous, {
        selectedItemIds: this.value.selectedItemIds,
        selectedLayerIds: this.value.selectedLayerIds,
        playheadUs: this.value.playheadUs,
      });
      this.sequenceRevision += 1;
    }
    const stored = this.sequences.get(sequenceId) ?? {
      selectedItemIds: [],
      selectedLayerIds: [],
      playheadUs: 0,
    };
    this.value = {
      ...stored,
      activeSequenceId: sequenceId,
      contextRevision: this.value.contextRevision + (previous ? 1 : 0),
    };
    return true;
  }

  retainSequences(ids: Set<string>): void {
    for (const id of this.sequences.keys())
      if (!ids.has(id)) this.sequences.delete(id);
  }

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
      activeSequenceId: this.value.activeSequenceId,
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
    this.sequences.clear();
    this.sequenceRevision += 1;
    this.value = {
      contextRevision: this.value.contextRevision + 1,
      selectedItemIds: [],
      selectedLayerIds: [],
      playheadUs: 0,
    };
  }
}
