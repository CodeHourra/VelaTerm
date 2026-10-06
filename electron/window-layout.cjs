// Native presentation policy comes from the same backend resource embedded by the Tauri host.
const path = require("node:path");

function loadPolicy(app) {
  return require(app.isPackaged
    ? path.join(process.resourcesPath, "window-layout.json")
    : path.join(__dirname, "../src-tauri/resources/window-layout.json"));
}

function windowOptions(policy, area) {
  if (!area || area.width <= 0 || area.height <= 0) {
    return {
      width: policy.fallbackWidth,
      height: policy.fallbackHeight,
      minWidth: policy.minWidth,
      minHeight: policy.minHeight,
      center: true,
    };
  }
  const availableWidth = Math.max(1, Math.floor(area.width - policy.edgeMargin * 2));
  const availableHeight = Math.max(1, Math.floor(area.height - policy.edgeMargin * 2));
  const width = Math.min(availableWidth,
    Math.max(policy.minWidth, Math.min(policy.maxWidth, Math.round(area.width * policy.widthRatio))));
  const height = Math.min(availableHeight,
    Math.max(policy.minHeight, Math.min(policy.maxHeight, Math.round(area.height * policy.heightRatio))));
  // Electron work areas and outer window bounds already use logical pixels, including negative origins.
  return {
    width,
    height,
    minWidth: Math.min(policy.minWidth, width),
    minHeight: Math.min(policy.minHeight, height),
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
  };
}

module.exports = { loadPolicy, windowOptions };
