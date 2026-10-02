import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Group, Project, ProjectFolder } from "../../types";
import type { TreeHandlers } from "./ProjectTree";

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  setProjectFolder: vi.fn(),
  toggleProjectFolderCollapsed: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (index: number) => string }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * 28 })),
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
  }),
}));
vi.mock("../../store/termStore", () => ({
  useTermStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  ),
  isVisibleSession: () => false,
}));
vi.mock("../../store/projectFolders", () => ({
  setProjectFolder: mocks.setProjectFolder,
  toggleProjectFolderCollapsed: mocks.toggleProjectFolderCollapsed,
}));
vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../components/Icons", () => ({ default: new Proxy({}, { get: () => () => null }) }));
vi.mock("../../components/StatusIndicator", () => ({ StatusIndicator: () => null }));
vi.mock("../sessionViewers/sessionMeta", () => ({ SessionKindIcon: () => null }));
vi.mock("../../hooks/useGitBranch", () => ({ useGitBranch: () => null }));
vi.mock("../../hooks/shortcutRegistry", () => ({
  DEFAULT_BINDINGS: { openProject: "Mod+O" },
  formatCombo: (combo: string) => combo,
}));
vi.mock("../../ipc/shareBase", () => ({ isShareSurface: false }));
vi.mock("../../sharing/sessionNavigation", () => ({
  navigateSharedSession: vi.fn(),
  sharedSessionUrl: () => "",
}));

import { ProjectTree } from "./ProjectTree";

const folder = (id: string, name: string, sortOrder: number, collapsed = false): ProjectFolder => ({
  id,
  name,
  sortOrder,
  collapsed,
  createdAt: 0,
});
const project = (id: string, name: string, sortOrder: number, folderId: string | null, collapsed = true): Project => ({
  id,
  name,
  rootPath: `/tmp/${id}`,
  sortOrder,
  collapsed,
  createdAt: 0,
  folderId,
});
const handlers = (overrides: Partial<TreeHandlers> = {}): TreeHandlers => ({
  view: {
    id: "main",
    name: "Main",
    treeFilter: "",
    statusFilter: null,
    statusFilterIds: null,
    markFilter: null,
    collapsedOverrides: null,
  },
  isPrimary: true,
  onContext: vi.fn(),
  contextId: null,
  renamingId: null,
  renameVal: "",
  setRenameVal: vi.fn(),
  commitRename: vi.fn(),
  cancelRename: vi.fn(),
  onAddSession: vi.fn(),
  onAddGroup: vi.fn(),
  ...overrides,
});
const names = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".row .nm")).map((el) => el.textContent);
const rowOf = (text: string) => screen.getByText(text).closest(".row") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setProjectFolder.mockResolvedValue(undefined);
  mocks.toggleProjectFolderCollapsed.mockResolvedValue(undefined);
  mocks.state = {
    projects: [
      project("p-web", "payments-web", 1, "f-pay"),
      project("p-notes", "notes", 2, null),
      project("p-api", "payments-api", 3, "f-pay"),
    ],
    projectFolders: [folder("f-pay", "Payments", 1), folder("f-empty", "Empty", 2)],
    groups: [] as Group[],
    sessions: [],
    ephemeralSessions: {},
    runtimes: {},
    notifications: {},
    treeLoaded: true,
    shortcutOverrides: {},
    activeSessionId: null,
    revealProjectId: null,
    revealSuppressId: null,
    density: "regular",
    navLayout: "regular",
    selection: [],
    selectionAnchor: null,
    setCreateProjectModalOpen: vi.fn(),
    importProject: vi.fn(),
    setCloneModalOpen: vi.fn(),
    toggleCollapsed: vi.fn(),
    openSession: vi.fn(),
    setRevealProject: vi.fn(),
    setRevealSuppress: vi.fn(),
    moveNode: vi.fn(),
    moveMany: vi.fn(),
    selectSingle: vi.fn(),
    toggleSelect: vi.fn(),
    setSelection: vi.fn(),
    setInspectTarget: vi.fn(),
    setSidebarTreeViewCollapsed: vi.fn(),
  };
});

describe("folder rows", () => {
  it("lists folders with their projects indented, then loose projects", () => {
    const { container } = render(<ProjectTree {...handlers()} />);
    expect(names(container)).toEqual(["Payments", "payments-web", "payments-api", "Empty", "notes"]);
    expect(within(rowOf("Payments")).getByText("2")).toBeTruthy();
    expect(rowOf("payments-web").style.paddingLeft).toBe("19px");
    expect(rowOf("notes").style.paddingLeft).toBe("6px");
  });

  it("hides a collapsed folder's projects", () => {
    mocks.state.projectFolders = [folder("f-pay", "Payments", 1, true), folder("f-empty", "Empty", 2)];
    const { container } = render(<ProjectTree {...handlers()} />);
    expect(names(container)).toEqual(["Payments", "Empty", "notes"]);
  });

  it("opens folders and drops empty ones while filtering", () => {
    mocks.state.projectFolders = [folder("f-pay", "Payments", 1, true), folder("f-empty", "Empty", 2)];
    const base = handlers();
    const { container } = render(<ProjectTree {...base} view={{ ...base.view, treeFilter: "api" }} />);
    expect(names(container)).toEqual(["Payments", "payments-api"]);
  });

  it("toggles the shared collapse state from the primary pane", () => {
    render(<ProjectTree {...handlers()} />);
    fireEvent.click(rowOf("Payments"));
    expect(mocks.toggleProjectFolderCollapsed).toHaveBeenCalledWith("f-pay");
  });

  it("keeps a split-off pane's folder collapse to that pane", () => {
    const base = handlers();
    render(
      <ProjectTree {...base} isPrimary={false} view={{ ...base.view, id: "side", collapsedOverrides: {} }} />,
    );
    fireEvent.click(rowOf("Payments"));
    expect(mocks.state.setSidebarTreeViewCollapsed).toHaveBeenCalledWith("side", "f-pay", true);
    expect(mocks.toggleProjectFolderCollapsed).not.toHaveBeenCalled();
  });

  it("expands a collapsed folder to reveal the active session", () => {
    mocks.state.projectFolders = [folder("f-pay", "Payments", 1, true)];
    mocks.state.projects = [project("p-api", "payments-api", 1, "f-pay", false)];
    mocks.state.sessions = [
      {
        id: "s1",
        projectId: "p-api",
        groupId: null,
        parentSessionId: null,
        name: "shell",
        kind: "terminal",
        collapsed: false,
        sortOrder: 0,
        createdAt: 0,
      },
    ];
    mocks.state.activeSessionId = "s1";
    render(<ProjectTree {...handlers()} />);
    expect(mocks.toggleProjectFolderCollapsed).toHaveBeenCalledWith("f-pay");
  });

  it("expands a collapsed folder to reveal a freshly opened project", () => {
    mocks.state.projectFolders = [folder("f-pay", "Payments", 1, true)];
    mocks.state.revealProjectId = "p-api";
    render(<ProjectTree {...handlers()} />);
    expect(mocks.toggleProjectFolderCollapsed).toHaveBeenCalledWith("f-pay");
  });
});
