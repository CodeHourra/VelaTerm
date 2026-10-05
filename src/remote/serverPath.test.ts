import { describe, expect, it } from "vitest";
import {
  baseName,
  detectFlavor,
  expandHome,
  isAbsolutePath,
  joinPath,
  normalizePath,
  parentPath,
  pathCrumbs,
  samePath,
} from "./serverPath";

describe("serverPath on POSIX servers", () => {
  it("normalizes, joins, and walks up to the root", () => {
    expect(normalizePath("/Users//vlinx/Projects/", "posix")).toBe("/Users/vlinx/Projects");
    expect(joinPath("/Users/vlinx", "Projects", "posix")).toBe("/Users/vlinx/Projects");
    expect(joinPath("/", "etc", "posix")).toBe("/etc");
    expect(parentPath("/Users/vlinx", "posix")).toBe("/Users");
    expect(parentPath("/Users", "posix")).toBe("/");
    expect(parentPath("/", "posix")).toBe("/");
    expect(baseName("/", "posix")).toBe("/");
  });

  it("builds breadcrumbs and expands the home directory", () => {
    expect(pathCrumbs("/Users/vlinx", "posix")).toEqual([
      { name: "/", path: "/" },
      { name: "Users", path: "/Users" },
      { name: "vlinx", path: "/Users/vlinx" },
    ]);
    expect(expandHome("~/Projects", "/home/vlinx", "posix")).toBe("/home/vlinx/Projects");
    expect(expandHome("~", "/home/vlinx", "posix")).toBe("/home/vlinx");
    expect(isAbsolutePath("Projects", "posix")).toBe(false);
  });
});

describe("serverPath on Windows servers", () => {
  it("detects drive and UNC paths", () => {
    expect(detectFlavor("C:\\Users\\vlinx")).toBe("win");
    expect(detectFlavor("\\\\nas\\share")).toBe("win");
    expect(detectFlavor("/Users/vlinx")).toBe("posix");
  });

  it("keeps drive roots, accepts forward slashes, and uses backslashes", () => {
    expect(normalizePath("c:/Users/vlinx/", "win")).toBe("C:\\Users\\vlinx");
    expect(normalizePath("C:", "win")).toBe("C:\\");
    expect(joinPath("C:\\Users\\vlinx", "source")).toBe("C:\\Users\\vlinx\\source");
    expect(joinPath("C:\\", "Users", "win")).toBe("C:\\Users");
    expect(parentPath("C:\\Users", "win")).toBe("C:\\");
    expect(parentPath("C:\\", "win")).toBe("C:\\");
    expect(baseName("D:\\", "win")).toBe("D:");
    expect(parentPath("\\\\nas\\share\\team", "win")).toBe("\\\\nas\\share\\");
  });

  it("builds breadcrumbs, expands ~, and compares without case", () => {
    expect(pathCrumbs("C:\\Users\\vlinx", "win").map((c) => c.name)).toEqual(["C:", "Users", "vlinx"]);
    expect(pathCrumbs("C:\\Users\\vlinx", "win")[1].path).toBe("C:\\Users");
    expect(expandHome("~\\source", "C:\\Users\\vlinx", "win")).toBe("C:\\Users\\vlinx\\source");
    expect(samePath("c:\\users\\VLINX", "C:\\Users\\vlinx", "win")).toBe(true);
    expect(isAbsolutePath("source\\repos", "win")).toBe(false);
  });
});
