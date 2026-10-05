//! Location field shared by the Clone and Create Project dialogs: an editable path plus a Browse… button. What the
//! user types is the value; Browse opens the system folder dialog on desktop and FolderPickerModal in browser and
//! remote windows. `useDestination` checks the final `location/name` path live so the dialog can say whether it
//! can be used before anything runs on the server.

import { useEffect, useRef, useState } from "react";
import Icons from "../components/Icons";
import { useT } from "../i18n";
import { listDir, previewDestination, type DestinationPreview } from "../ipc/info";
import { isTauri } from "../ipc/transport";
import { env, platform } from "../platform";
import { FolderPickerModal } from "./FolderPickerModal";
import { isAbsolutePath, serverFs } from "./serverPath";
import { setLocationPickerOpen, useDialogDraft } from "./dialogNavigation";

const LOCATION_KEY = "vlxterm.projectLocation";

/** Remember the parent folder of the last project created or cloned. */
export function rememberProjectLocation(path: string) {
  try {
    localStorage.setItem(LOCATION_KEY, path);
  } catch {
    /* Without localStorage the next dialog starts at Home. */
  }
}

/**
 * Location state for a project dialog: prefilled with the last location used when it still exists on this
 * server, otherwise Home. Typing before the prefill arrives wins.
 */
export function useProjectLocation(open: boolean): [string, (value: string) => void] {
  const [value, setValue] = useDialogDraft("projectParent", open);
  const current = useRef(value);
  const touched = useRef(false);
  current.current = value;

  useEffect(() => {
    if (!open) return;
    touched.current = false;
    let cancelled = false;
    let last = "";
    try {
      last = localStorage.getItem(LOCATION_KEY) || "";
    } catch {
      /* Treated as no remembered location. */
    }
    void serverFs().then(async (fs) => {
      let start = fs.home;
      if (last && isAbsolutePath(last, fs.flavor)) {
        start = await listDir(last).then(() => last, () => fs.home);
      }
      if (!cancelled && !touched.current && !current.current) setValue(start);
    }).catch(() => { /* ExecutionContext displays the unavailable server state; no fallback path is invented. */ });
    return () => {
      cancelled = true;
    };
  }, [open, setValue]);

  return [value, (next) => { touched.current = true; setValue(next); }];
}

export type Destination = DestinationPreview & { kind: "idle" | "checking" | "ok" | "bad"; message: string };
const EMPTY_DESTINATION: Destination = { kind: "idle", parent: "", name: "", path: "", message: "", problem: null, field: null, existingKind: null };

/**
 * Live check of `location/name`: the location must be a full path to an existing folder and must not already
 * contain an entry with that name. `parent` in the result is the normalized location with `~` expanded, which is
 * what the dialog should submit.
 */
export function useDestination(location: string, name: string | null, enabled: boolean, repository?: string, allowFile = false): Destination {
  const t = useT();
  const key = JSON.stringify([location, name, repository ?? null, allowFile]);
  const [state, setState] = useState<{ key: string; value: Destination }>({ key: "", value: EMPTY_DESTINATION });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void previewDestination(location, name, repository).then((preview) => {
        if (cancelled) return;
        const empty = preview.problem === "emptyParent" || preview.problem === "emptyName";
        const collision = preview.existingKind !== null && !(allowFile && preview.existingKind === "file");
        const message = preview.problem === "notAbsolute" ? t("location.notAbsolute")
          : preview.problem === "invalidName" ? t("location.invalidName")
          : preview.problem === "missingParent" ? t("location.missing", preview.parent)
          : preview.problem ? t("location.validationFailed")
          : collision ? t("location.exists") : "";
        setState({ key, value: { ...preview, kind: empty ? "idle" : preview.problem || collision ? "bad" : "ok", message,
          field: collision ? "name" : preview.field } });
      }).catch(() => {
        if (!cancelled) setState({ key, value: { ...EMPTY_DESTINATION, kind: "bad", field: "location", message: t("location.validationFailed") } });
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, location, name, repository, enabled, allowFile, t]);

  // An input change invalidates the old result during render, before the debounce or effect can run.
  if (state.key !== key) return { ...EMPTY_DESTINATION, kind: enabled ? "checking" : "idle" };
  return state.value;
}

/** Full target path with the new folder highlighted, plus whether it can be used. */
export function DestinationBox({ dest, label, readyLabel }: { dest: Destination; label: string; readyLabel?: string }) {
  const t = useT();
  const leafAt = Math.max(dest.path.lastIndexOf("/"), dest.path.lastIndexOf("\\")) + 1;
  const ok = dest.kind === "ok";
  return (
    <div className={"fp-dest" + (ok ? " ok" : dest.kind === "bad" ? " bad" : "")} aria-live="polite">
      <Icons.folder size={21} />
      <div className="fp-dest-text">
        <span className="fp-dest-label">{label}</span>
        <span className="fp-dest-path">
          {dest.path ? <>{dest.path.slice(0, leafAt)}<span className="fp-leaf">{dest.path.slice(leafAt)}</span></> : t("location.enterTarget")}
        </span>
      </div>
      {dest.kind !== "idle" && <span className="fp-dest-status">
        {ok ? <Icons.check size={18} /> : dest.kind === "bad" ? <Icons.warn size={17} /> : <span className="fp-spin" />}
        {dest.kind === "bad" ? dest.message : ok ? (readyLabel ?? t("location.ready")) : t("location.checking")}
      </span>}
    </div>
  );
}

export function LocationField({
  id,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const t = useT();
  const [picking, setPicking] = useState(() => new URLSearchParams(window.location.search).get("picker") === "location");
  const native = isTauri || env.isElectron;
  useEffect(() => {
    const update = () => setPicking(new URLSearchParams(window.location.search).get("picker") === "location");
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const browse = async () => {
    if (!native) {
      setLocationPickerOpen(true);
      return;
    }
    const picked = await platform.dialog.pickDirectory();
    if (picked) onChange(picked);
  };

  return (
    <div className="fp-loc">
      <input
        id={id}
        className={"vlx-input" + (invalid ? " bad" : "")}
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
      {native ? <button type="button" className="vlx-btn" disabled={disabled} onClick={() => void browse()}>
        <Icons.folder size={13} />
        {t("location.browse")}
      </button> : <a className="vlx-btn" aria-disabled={disabled} tabIndex={disabled ? -1 : undefined}
        href={(() => { const url = new URL(window.location.href); url.searchParams.set("picker", "location"); return url.href; })()}
        onClick={(e) => {
          if (disabled) { e.preventDefault(); return; }
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault(); void browse();
        }}><Icons.folder size={15} />{t("location.browse")}</a>}
      {picking && (
        <FolderPickerModal
          title={t("location.pickerTitle")}
          confirmLabel={t("dir.choose")}
          initialPath={value || undefined}
          zIndex={320}
          onCancel={() => setLocationPickerOpen(false)}
          onChoose={(path) => {
            onChange(path);
            setLocationPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
