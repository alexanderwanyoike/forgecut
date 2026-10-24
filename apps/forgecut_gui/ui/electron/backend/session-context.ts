import type { EditingContext } from "../shared/ipc-contract.js";

type ContextValues = Omit<EditingContext, "sessionId">;

export class SessionContext {
  private value: ContextValues = {
    contextRevision: 0,
    selectedItemIds: [],
    playheadUs: 0,
  };

  snapshot(): ContextValues {
    return structuredClone(this.value);
  }

  update(selectedItemIds: string[], playheadUs: number): void {
    const selection = [...new Set(selectedItemIds)];
    if (
      JSON.stringify(selection) ===
        JSON.stringify(this.value.selectedItemIds) &&
      playheadUs === this.value.playheadUs
    )
      return;
    this.value = {
      contextRevision: this.value.contextRevision + 1,
      selectedItemIds: selection,
      playheadUs,
    };
  }

  reconcile(itemIds: Set<string>): void {
    this.update(
      this.value.selectedItemIds.filter((id) => itemIds.has(id)),
      this.value.playheadUs,
    );
  }

  clear(): void {
    this.value = {
      contextRevision: this.value.contextRevision + 1,
      selectedItemIds: [],
      playheadUs: 0,
    };
  }
}
