//! Collection creation and renaming reuse the shared asynchronous form with URL-backed presentation drafts.

import { FormModal } from "../../components/FormModal";
import { useT } from "../../i18n";
import { useTermStore } from "../../store/termStore";
import { collectionNameTaken } from "../../types";
import { lockCollectionNavigation, navigateCollectionDialog, writeCollectionDraft, type CollectionDialogRoute } from "./collectionNavigation";

export function CollectionDialog({ route }: { route: CollectionDialogRoute }) {
  const t = useT();
  const projects = useTermStore(s => s.projects);
  const treeLoaded = useTermStore(s => s.treeLoaded);
  const project = projects.find(p => p.id === route.id);
  if (route.kind === "rename" && !treeLoaded) return null;
  return <FormModal
    key={`${route.kind}:${route.id}:${route.parentId}:${route.draft}`}
    title={route.kind === "create" ? t("collection.title") : t("collection.renameTitle")}
    fields={[{ key: "name", label: t("collection.name"), placeholder: t("collection.namePlaceholder"), required: true, autoFocus: true }]}
    initial={{ name: route.draft ?? project?.name ?? "" }}
    submitLabel={route.kind === "create" ? t("collection.submit") : t("common.save")}
    validate={values => collectionNameTaken(projects, values.name, route.id ?? undefined) ? t("collection.duplicateName") : null}
    formatSubmitError={error => {
      const message = error instanceof Error ? error.message : String(error);
      return message.includes("A collection with this name already exists") ? t("collection.duplicateName") : message;
    }}
    onValuesChange={values => writeCollectionDraft(values.name)}
    onCancel={() => navigateCollectionDialog(null)}
    onSubmit={async values => {
      lockCollectionNavigation(true);
      try {
        const state = useTermStore.getState();
        if (route.kind === "create") {
          if (route.parentId) await state.addVirtualProject(values.name.trim(), route.parentId);
          else await state.addVirtualProject(values.name.trim());
        }
        else await state.renameNode("project", route.id!, values.name.trim());
        lockCollectionNavigation(false);
        navigateCollectionDialog(null);
      } finally { lockCollectionNavigation(false); }
    }}
  />;
}
