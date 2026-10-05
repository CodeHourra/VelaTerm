//! Collection membership uses the backend tree as its authority, including recovery after a rejected move.

import * as tree from "../ipc/tree";
import { useTermStore } from "./termStore";

export async function setProjectCollection(projectId: string, collectionId: string | null): Promise<void> {
  try {
    await tree.setProjectCollection(projectId, collectionId);
    useTermStore.setState({ treeMutationError: null });
  } catch (error) {
    useTermStore.setState({ treeMutationError: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await useTermStore.getState().loadTree();
  }
}
