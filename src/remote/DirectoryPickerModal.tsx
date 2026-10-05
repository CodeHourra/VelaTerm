//! Import-project folder picker for browser and remote windows, which have no native folder dialog. The chosen
//! folder on the server is imported as a project; desktop shells use the system dialog instead (store.importProject).

import { useT } from "../i18n";
import { useTermStore } from "../store/termStore";
import { FolderPickerModal } from "./FolderPickerModal";

export function DirectoryPickerModal() {
  const t = useT();
  const open = useTermStore((s) => s.dirPickerOpen);
  const setOpen = useTermStore((s) => s.setDirPickerOpen);
  const importProjectPath = useTermStore((s) => s.importProjectPath);
  if (!open) return null;
  return (
    <FolderPickerModal
      title={t("dir.title")}
      confirmLabel={t("dir.choose")}
      busyLabel={t("dir.importing")}
      onCancel={() => setOpen(false)}
      onChoose={importProjectPath}
    />
  );
}
