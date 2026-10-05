//! Synchronize modal presentation with URLs without replaying commands or pending document writes.

import { useEffect } from "react";
import { useTermStore } from "../store/termStore";
import { readProjectDialog, restoreLockedDialog } from "./dialogNavigation";

export function ProjectDialogRoutes() {
  useEffect(() => {
    const update = () => {
      if (restoreLockedDialog()) return;
      const kind = readProjectDialog();
      const state = useTermStore.getState();
      if (kind !== "save" && state.saveAsRequest) state.saveAsRequest.resolve(null);
      useTermStore.setState({
        cloneModalOpen: kind === "clone", createProjectModalOpen: kind === "create", dirPickerOpen: kind === "open",
        ...(kind !== "save" ? { saveAsRequest: null } : {}),
      });
    };
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return null;
}
