//! Agent installation guidance as the single source of truth for each host platform.
//!
//! When the interactive-shell launch guard reports `not found on PATH`, AgentInstallCard obtains its
//! recommended command, documentation link, and authentication guidance here. Installation changes need
//! only this module, following the same pattern as `inject::permission_flag`.
//!
//! Commands branch by host OS and prefer native installers without Node, falling back to global npm with
//! `needs_node=true`. They run directly in the agent session's PowerShell on Windows or login shell on Unix.
//!
//! Only local agent types have guidance; terminal and browser sessions do not.

/// Platform-specific agent installation guidance serialized to frontend camelCase.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRecipe {
    /// Agent display name such as Claude Code or Codex.
    pub label: String,
    /// Executable command name.
    pub bin: String,
    /// Recommended command executable directly in the session shell.
    pub command: String,
    /// Whether installation requires Node/npm, allowing the frontend to warn accordingly.
    pub needs_node: bool,
    /// Official installation documentation URL.
    pub docs_url: String,
    /// English one-line authentication step still required after installing the binary.
    pub auth_hint: String,
}

/// Return platform guidance for a frontend AgentKind, or None for unknown/unsupported types.
pub fn install_recipe(agent: &str) -> Option<InstallRecipe> {
    // Select commands/installers from the compile-time host OS.
    let win = cfg!(target_os = "windows");
    let r = match agent {
        "claude" => InstallRecipe {
            label: "Claude Code".into(),
            bin: "claude".into(),
            // Official native installer: PowerShell on Windows or curl on Unix, with no Node dependency.
            command: if win {
                "irm https://claude.ai/install.ps1 | iex".into()
            } else {
                "curl -fsSL https://claude.ai/install.sh | bash".into()
            },
            needs_node: false,
            docs_url: "https://code.claude.com/docs/en/setup".into(),
            auth_hint: "Run `claude` and log in via the browser when prompted.".into(),
        },
        "codex" => InstallRecipe {
            label: "Codex".into(),
            bin: "codex".into(),
            // No standalone first-party installer. Use scoped @openai/codex; unscoped codex is unrelated.
            command: "npm install -g @openai/codex".into(),
            needs_node: true,
            docs_url: "https://developers.openai.com/codex/cli".into(),
            auth_hint: "Run `codex` and sign in with your ChatGPT account or an API key.".into(),
        },
        "opencode" => InstallRecipe {
            label: "OpenCode".into(),
            bin: "opencode".into(),
            // Unix has a native curl installer; Windows falls back to global npm. The package's postinstall is what
            // creates bin/opencode.exe, and newer npm skips install scripts unless allowed, so allow it explicitly
            // (older npm only warns about the unknown flag and runs scripts anyway).
            command: if win {
                "npm install -g --allow-scripts=opencode-ai opencode-ai".into()
            } else {
                "curl -fsSL https://opencode.ai/install | bash".into()
            },
            needs_node: win,
            docs_url: "https://opencode.ai/docs/".into(),
            auth_hint: "Run `opencode`, then `/login` (or set a provider API key).".into(),
        },
        "copilot" => InstallRecipe {
            label: "GitHub Copilot CLI".into(),
            bin: "copilot".into(),
            // Global npm only, requiring Node 22+ and an existing Copilot subscription.
            command: "npm install -g @github/copilot".into(),
            needs_node: true,
            docs_url: "https://docs.github.com/copilot/how-tos/set-up/install-copilot-cli".into(),
            auth_hint: "Requires Node 22+. Run `copilot`, then `/login` with your GitHub account."
                .into(),
        },
        "cursor" => InstallRecipe {
            label: "Cursor CLI".into(),
            bin: "cursor-agent".into(),
            // Official Node-free installer: Windows PowerShell with win32 or Unix curl.
            command: if win {
                "irm 'https://cursor.com/install?win32=true' | iex".into()
            } else {
                "curl https://cursor.com/install -fsS | bash".into()
            },
            needs_node: false,
            docs_url: "https://cursor.com/docs/cli/installation".into(),
            auth_hint: "Run `cursor-agent login` to authenticate.".into(),
        },
        "cline" => InstallRecipe {
            label: "Cline".into(),
            bin: "cline".into(),
            // Global npm only with the same Node-dependent command on Windows and Unix.
            command: "npm install -g cline".into(),
            needs_node: true,
            docs_url: "https://docs.cline.bot/cli/installation".into(),
            auth_hint: "Run `cline auth` to configure your provider and API key.".into(),
        },
        "pi" => InstallRecipe {
            label: "Pi".into(),
            bin: "pi".into(),
            // Global npm only; --ignore-scripts avoids running dependency packaging scripts.
            command: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent".into(),
            needs_node: true,
            docs_url: "https://pi.dev/".into(),
            auth_hint:
                "Run `pi`, then `/login` (Claude/ChatGPT/Copilot) or set a provider API key.".into(),
        },
        "omp" => InstallRecipe {
            label: "OMP".into(),
            bin: "omp".into(),
            // Official Node-free installer; it drops a single prebuilt binary into ~/.local/bin.
            command: if win {
                "irm https://omp.sh/install.ps1 | iex".into()
            } else {
                "curl -fsSL https://omp.sh/install | sh".into()
            },
            needs_node: false,
            docs_url: "https://omp.sh/".into(),
            auth_hint: "Run `omp`, complete the setup, or use `/login` inside a session.".into(),
        },
        "antigravity" => InstallRecipe {
            label: "Antigravity CLI".into(),
            // The executable is `agy`, matching inject.rs, not `antigravity`.
            bin: "agy".into(),
            // Official Node-free PowerShell/curl installer; `agy install` can configure PATH afterward.
            command: if win {
                "irm https://antigravity.google/cli/install.ps1 | iex".into()
            } else {
                "curl -fsSL https://antigravity.google/cli/install.sh | bash".into()
            },
            needs_node: false,
            docs_url: "https://antigravity.google/docs/cli-overview".into(),
            auth_hint: "Run `agy` and sign in with your Google account when prompted.".into(),
        },
        "crush" => InstallRecipe {
            label: "Crush".into(),
            bin: "crush".into(),
            // macOS uses the official Homebrew tap; Linux/Windows use global npm, whose postinstall downloads the Go
            // binary. Allow that script so the binary arrives during install instead of on the first launch.
            command: if cfg!(target_os = "macos") {
                "brew install charmbracelet/tap/crush".into()
            } else {
                "npm install -g --allow-scripts=@charmland/crush @charmland/crush".into()
            },
            needs_node: !cfg!(target_os = "macos"),
            docs_url: "https://github.com/charmbracelet/crush".into(),
            auth_hint:
                "Run `crush` and pick a provider in onboarding (sign in or set a provider API key)."
                    .into(),
        },
        "kimi" => InstallRecipe {
            label: "Kimi Code".into(),
            bin: "kimi".into(),
            command: if win {
                "irm https://code.kimi.com/kimi-code/install.ps1 | iex".into()
            } else {
                "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash".into()
            },
            needs_node: false,
            docs_url: "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html"
                .into(),
            auth_hint:
                "Run `kimi`, then `/login` to sign in with Kimi Code or configure an API key."
                    .into(),
        },
        "kiro" => InstallRecipe {
            // The official installer is a POSIX shell script. Windows support is unconfirmed and VelaTerm's
            // Windows sessions default to PowerShell, so hide one-click installation there while keeping the
            // documentation link and any manually configured executable path.
            label: "Kiro".into(),
            bin: "kiro-cli".into(),
            command: if win {
                String::new()
            } else {
                "curl -fsSL https://cli.kiro.dev/install | bash".into()
            },
            needs_node: false,
            docs_url: "https://kiro.dev/docs/cli/".into(),
            auth_hint: if win {
                "The Kiro CLI installer targets macOS and Linux. Install it in a supported environment or set a `kiro-cli` path in Settings > Agents.".into()
            } else {
                "Run `kiro-cli` and complete the sign-in prompt; installing the binary alone does not authenticate it.".into()
            },
        },
        "grok" => InstallRecipe {
            label: "Grok Build".into(),
            bin: "grok".into(),
            // Windows uses global npm; allow its postinstall, which places grok.exe under ~/.grok/bin.
            command: if win {
                "npm install -g --allow-scripts=@xai-official/grok @xai-official/grok".into()
            } else {
                "curl -fsSL https://x.ai/cli/install.sh | bash".into()
            },
            needs_node: win,
            docs_url: "https://docs.x.ai/build/overview".into(),
            auth_hint:
                "Run `grok login` to sign in, or set `XAI_API_KEY`; use `grok models` to list available models."
                    .into(),
        },
        "zoo" => {
            // Zoo Code currently reuses Roo CLI and `roo`. Its installer lacks Windows support and there is
            // no public npm package, so return an empty Windows command to hide one-click installation while
            // retaining documentation and allowing a manually built roo.exe path.
            let unsupported = win || cfg!(all(target_os = "macos", target_arch = "x86_64"));
            InstallRecipe {
                label: "Zoo Code".into(),
                bin: "roo".into(),
                command: if unsupported {
                    String::new()
                } else {
                    "curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh"
                        .into()
                },
                needs_node: true,
                docs_url: "https://docs.zoocode.dev/update-notes/v3.39".into(),
                auth_hint: if unsupported {
                    "Zoo Code CLI currently ships for macOS Apple Silicon and Linux x64/ARM64. Use a supported environment or set a manually built `roo` path in Settings > Agents.".into()
                } else {
                    "Run `roo` with a provider API key (for example `OPENROUTER_API_KEY`) or pass provider/model launch arguments.".into()
                },
            }
        }
        _ => return None,
    };
    Some(r)
}

/// Detect an installed executable only at known locations produced by the recommended command. Stat each
/// candidate, require Unix executability, return an absolute match, and never guess.
///
/// One-click installers often modify a profile that the current session has not reloaded. Retry Launch uses
/// this result to fill an empty executable-path setting so the next launch uses the absolute path.
///
/// A generated Windows command wrapper whose payload is gone is not a match: that state comes from a failed
/// or interrupted install, and handing out the wrapper only produces an opaque cmd.exe path error.
///
/// Strategies mirror install_recipe: native installers stat fixed locations; global npm installations query
/// `npm prefix -g`. Unix probes interactive profiles for nvm/fnm accuracy; Windows uses cmd /C.
pub fn locate_installed_bin(agent: &str) -> Option<String> {
    let (bin, mut candidates, use_npm) = agent_layout(agent)?;
    if use_npm {
        push_npm_candidates(&mut candidates, bin);
    }
    candidates
        .into_iter()
        .find(|p| super::executable::is_executable_file(p))
        .map(|p| p.to_string_lossy().to_string())
}

/// The launch catalogue owns the complete agent list. Share npm probes across the whole terminal, rather than
/// starting a shell for each npm-based agent. Every returned path is validated by the same install guard.
pub(crate) fn locate_installed_bins(shell: &str, cwd: Option<&std::path::Path>, agent: bool) -> (Vec<String>, Option<crate::login_env::SessionEnvironment>) {
    #[cfg(unix)]
    let _ = agent;
    #[cfg(unix)]
    let (prefixes, discovered, path) = shell_installations_in(shell, cwd);
    #[cfg(windows)]
    let (prefixes, discovered, path) = (npm_global_prefixes(), Vec::<String>::new(), crate::login_env::latest_terminal_environment(shell, cwd, agent));
    let current_path = path.as_ref().and_then(|env| env.path());
    let mut binaries = locate_installed_bins_with(agent_layout, || prefixes.clone());
    binaries.extend(discovered);
    for option in super::launch_options::catalog() {
        if !matches!(option.id, crate::models::SessionKind::Terminal | crate::models::SessionKind::Browser) {
            let bin = super::executable::command_name(option.id);
            if let Some(found) = current_path.as_ref().and_then(|path| super::executable::find_on_path_in(bin, path))
                .or_else(|| super::executable::find_on_path(bin))
            {
                binaries.push(found);
            }
        }
    }
    (binaries, path)
}

fn locate_installed_bins_with(
    layout: impl Fn(&str) -> Option<(&'static str, Vec<std::path::PathBuf>, bool)>,
    npm_prefixes: impl Fn() -> Vec<std::path::PathBuf>,
) -> Vec<String> {
    let mut prefixes = None;
    let mut binaries = Vec::new();
    for option in super::launch_options::catalog() {
        let Some((bin, mut candidates, use_npm)) = layout(option.id.as_str()) else { continue; };
        if use_npm {
            let prefixes = prefixes.get_or_insert_with(&npm_prefixes);
            for prefix in prefixes.iter() { push_npm_candidates_at(&mut candidates, bin, prefix); }
        }
        if let Some(path) = candidates.into_iter().find(|path| super::executable::is_executable_file(path)) {
            binaries.push(path.to_string_lossy().into_owned());
        }
    }
    binaries
}

/// Whether the recommended npm installation exists in name only: the generated command wrapper is on
/// disk but the program it forwards to is gone.
///
/// A failed, interrupted, or quarantined install leaves exactly that state, because npm removes the
/// package while keeping the wrapper it created. Launching that wrapper prints only cmd.exe's bare path
/// error, so the launch path reports the agent as missing and shows the installation guidance instead.
pub fn dangling_npm_install(agent: &str) -> bool {
    let Some((bin, _, true)) = agent_layout(agent) else {
        return false;
    };
    npm_global_prefixes().iter().any(|prefix| {
        let shim = npm_bin_candidate(prefix, bin, cfg!(target_os = "windows"));
        shim.is_file() && !super::executable::is_executable_file(&shim)
    })
}

/// Install layout for one agent on this host: the command name, fixed-location candidates in priority
/// order, and whether the recommended installation is a global npm package. npm-only types leave the
/// fixed list empty; their candidate comes from `npm_bin_candidate`.
fn agent_layout(agent: &str) -> Option<(&'static str, Vec<std::path::PathBuf>, bool)> {
    let home = crate::host::home_dir()?;
    agent_layout_at(agent, &home)
}

fn agent_layout_at(agent: &str, home: &std::path::Path) -> Option<(&'static str, Vec<std::path::PathBuf>, bool)> {
    let win = cfg!(target_os = "windows");
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    let layout = match agent {
        // Claude's official installer targets ~/.local/bin.
        "claude" => {
            candidates.push(
                home.join(".local")
                    .join("bin")
                    .join(exe_name("claude", win)),
            );
            ("claude", false)
        }
        // Cursor's Unix installer links ~/.local/bin/cursor-agent. The Windows installer copies its
        // cursor-agent* launchers into %LOCALAPPDATA%\cursor-agent instead.
        "cursor" => {
            if win {
                let root = local_app_data(&home).join("cursor-agent");
                candidates.push(root.join("cursor-agent.exe"));
                candidates.push(root.join("cursor-agent.cmd"));
            }
            candidates.push(
                home.join(".local")
                    .join("bin")
                    .join(exe_name("cursor-agent", win)),
            );
            ("cursor-agent", false)
        }
        // OpenCode's Unix script uses ~/.opencode/bin or, in some versions, ~/.local/bin; Windows uses npm.
        "opencode" => {
            if !win {
                candidates.push(home.join(".opencode").join("bin").join("opencode"));
                candidates.push(home.join(".local").join("bin").join("opencode"));
            }
            ("opencode", win)
        }
        "codex" => ("codex", true),
        "copilot" => ("copilot", true),
        // Cline is global npm only, so infer it from the npm prefix.
        "cline" => ("cline", true),
        // Pi has no native installer and uses global npm only.
        "pi" => ("pi", true),
        // OMP's official installer writes a single binary to PI_INSTALL_DIR when set, otherwise ~/.local/bin/omp
        // on Unix and %LOCALAPPDATA%\omp\omp.exe on Windows, so stat those paths rather than an npm prefix.
        "omp" => {
            if let Some(dir) = std::env::var_os("PI_INSTALL_DIR").filter(|d| !d.is_empty()) {
                candidates.push(std::path::PathBuf::from(dir).join(exe_name("omp", win)));
            }
            if win {
                candidates.push(local_app_data(&home).join("omp").join("omp.exe"));
            }
            candidates.push(home.join(".local").join("bin").join(exe_name("omp", win)));
            ("omp", false)
        }
        // Grok's native installer targets ~/.grok/bin; also probe ~/.local/bin for manually linked installs.
        // Windows uses the official npm fallback.
        "grok" => {
            if !win {
                candidates.push(home.join(".grok").join("bin").join("grok"));
                candidates.push(home.join(".local").join("bin").join("grok"));
            }
            ("grok", win)
        }
        // Antigravity's installer writes ~/.local/bin/agy on Unix and %LOCALAPPDATA%\agy\bin\agy.exe on Windows;
        // otherwise fall back to command-name launch, `agy install`, or a manual setting.
        "antigravity" => {
            if win {
                candidates.push(local_app_data(&home).join("agy").join("bin").join("agy.exe"));
            }
            candidates.push(home.join(".local").join("bin").join(exe_name("agy", win)));
            ("agy", false)
        }
        // Crush uses Homebrew prefixes on macOS and global npm prefixes on Linux/Windows.
        "crush" => {
            if cfg!(target_os = "macos") {
                candidates.push(std::path::PathBuf::from("/opt/homebrew/bin/crush"));
                candidates.push(std::path::PathBuf::from("/usr/local/bin/crush"));
                ("crush", false)
            } else {
                ("crush", true)
            }
        }
        // Kimi installers have used ~/.kimi-code/bin and ~/.local/bin; prefer KIMI_CODE_HOME/bin when set.
        "kimi" => {
            if let Some(root) = std::env::var_os("KIMI_CODE_HOME") {
                candidates.push(
                    std::path::PathBuf::from(root)
                        .join("bin")
                        .join(exe_name("kimi", win)),
                );
            }
            candidates.push(
                home.join(".kimi-code")
                    .join("bin")
                    .join(exe_name("kimi", win)),
            );
            candidates.push(home.join(".local").join("bin").join(exe_name("kimi", win)));
            ("kimi", false)
        }
        // The Kiro installer drops the binary in ~/.local/bin; honor KIRO_HOME/bin when it is set.
        "kiro" => {
            if let Some(root) = std::env::var_os("KIRO_HOME") {
                candidates.push(
                    std::path::PathBuf::from(root)
                        .join("bin")
                        .join(exe_name("kiro-cli", win)),
                );
            }
            candidates.push(
                home.join(".local")
                    .join("bin")
                    .join(exe_name("kiro-cli", win)),
            );
            candidates.push(
                home.join(".kiro")
                    .join("bin")
                    .join(exe_name("kiro-cli", win)),
            );
            ("kiro-cli", false)
        }
        // Zoo/Roo installs at ~/.roo/cli/bin/roo with a ~/.local/bin symlink, so probe both.
        "zoo" => {
            candidates.push(home.join(".local").join("bin").join(exe_name("roo", win)));
            candidates.push(
                home.join(".roo")
                    .join("cli")
                    .join("bin")
                    .join(exe_name("roo", win)),
            );
            ("roo", false)
        }
        _ => return None,
    };
    Some((layout.0, candidates, layout.1))
}

/// Adds the global npm candidates for one command: first the real program a generated wrapper forwards
/// to, then the wrapper itself as the fallback.
///
/// Launching the payload directly avoids cmd.exe re-parsing the wrapper's arguments, which can mangle
/// structured values such as JSON.
fn push_npm_candidates(candidates: &mut Vec<std::path::PathBuf>, bin: &str) {
    for prefix in npm_global_prefixes() { push_npm_candidates_at(candidates, bin, &prefix); }
}

fn push_npm_candidates_at(candidates: &mut Vec<std::path::PathBuf>, bin: &str, prefix: &std::path::Path) {
    let shim = npm_bin_candidate(prefix, bin, cfg!(target_os = "windows"));
    if let Some(exe) = super::executable::shim_payload_exe(&shim) {
        candidates.push(exe);
    }
    candidates.push(shim);
}

/// Executable filename with `.exe` for native Windows installers and a bare name on Unix.
fn exe_name(name: &str, win: bool) -> String {
    if win {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// `%LOCALAPPDATA%`, falling back to `<home>\AppData\Local` when the variable is missing.
fn local_app_data(home: &std::path::Path) -> std::path::PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home.join("AppData").join("Local"))
}

/// Global npm executable path: `<prefix>/bin/<name>` on Unix or `<prefix>\<name>.cmd` on Windows.
fn npm_bin_candidate(prefix: &std::path::Path, bin: &str, win: bool) -> std::path::PathBuf {
    if win {
        prefix.join(format!("{bin}.cmd"))
    } else {
        prefix.join("bin").join(bin)
    }
}

/// Read every npm prefix exposed by the user's interactive environment. Bash may initialize nvm/fnm only
/// in .bashrc; an interactive login probe alone would miss it. Windows retains cmd /C semantics.
fn npm_global_prefixes() -> Vec<std::path::PathBuf> {
    #[cfg(windows)]
    {
        let mut prefixes = Vec::new();
        let mut command = crate::host::command("cmd");
        if let Some(path) = crate::login_env::latest_path() { command.env("PATH", path); }
        if let Ok(out) = command.args(["/C", "npm prefix -g"]).output() {
            if out.status.success() {
                if let Some(prefix) = npm_prefix_from_output(&out.stdout) { prefixes.push(prefix); }
            }
        }
        prefixes
    }
    #[cfg(unix)]
    {
        shell_installations(&probe_shell()).0
    }
}

#[cfg(unix)]
pub(crate) fn probe_shell() -> String {
    crate::appimage::clean_var("SHELL")
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            ["/bin/zsh", "/bin/bash"]
                .iter()
                .find(|p| std::path::Path::new(p).exists())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "/bin/sh".to_string())
}

/// Probe npm and every supported command together. Sentinels exclude startup banners from discovery.
/// These simple commands also work in Fish; all names originate in the backend launch catalogue.
#[cfg(unix)]
fn shell_installations(shell: &str) -> (Vec<std::path::PathBuf>, Vec<String>, Option<crate::login_env::SessionEnvironment>) {
    shell_installations_in(shell, None)
}

#[cfg(unix)]
fn shell_installations_in(shell: &str, cwd: Option<&std::path::Path>) -> (Vec<std::path::PathBuf>, Vec<String>, Option<crate::login_env::SessionEnvironment>) {
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let prefix_marker = format!("VLX_PREFIX_{nonce}");
    let bin_marker = format!("VLX_BINS_{nonce}");
    let end_marker = format!("VLX_END_{nonce}");
    let path_marker = format!("VLX_PATH_{nonce}");
    let path_end_marker = format!("VLX_PATH_END_{nonce}");
    let names = super::launch_options::catalog().into_iter()
        .filter(|option| !matches!(option.id, crate::models::SessionKind::Terminal | crate::models::SessionKind::Browser))
        .map(|option| format!("command -v {}", super::executable::command_name(option.id)))
        .collect::<Vec<_>>().join("; ");
    let path_script = crate::login_env::environment_capture(&path_marker, &path_end_marker);
    let script = format!("{path_script}; printf '\\n{prefix_marker}\\n'; npm prefix -g; printf '\\n{bin_marker}\\n'; {names}; printf '\\n{end_marker}\\n'");
    let mut prefixes = Vec::new();
    let mut binaries = Vec::new();
    let mut paths = Vec::new();
    for mode in super::executable::shell_probe_modes(shell) {
        if let Some(out) = super::executable::shell_probe_output_in(shell, mode, &script, crate::login_env::CAPTURE_LIMIT, cwd) {
            if let Some(path) = crate::login_env::captured_environment(&out, &path_marker, &path_end_marker) { paths.push(path); }
            let output = String::from_utf8_lossy(&out);
            let Some((_, body)) = output.split_once(&prefix_marker) else { continue; };
            let Some((npm, body)) = body.split_once(&bin_marker) else { continue; };
            if let Some(prefix) = npm_prefix_from_output(npm.as_bytes()) {
                if !prefixes.contains(&prefix) { prefixes.push(prefix); }
            }
            let Some((paths, _)) = body.split_once(&end_marker) else { continue; };
            for line in paths.lines().map(str::trim) {
                if std::path::Path::new(line).is_absolute() && super::executable::is_executable_file(std::path::Path::new(line)) {
                    if !binaries.iter().any(|bin| bin == line) { binaries.push(line.to_string()); }
                }
            }
        }
    }
    (prefixes, binaries, crate::login_env::combine_environments(&paths))
}

fn npm_prefix_from_output(stdout: &[u8]) -> Option<std::path::PathBuf> {
    // Shell profiles may print noise; npm's response is the last nonempty line.
    let stdout = String::from_utf8_lossy(stdout);
    let line = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())?
        .trim()
        .to_string();
    let p = std::path::PathBuf::from(line);
    (p.is_absolute() && p.is_dir()).then_some(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn fixture_executable(path: &std::path::Path, script: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, script).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn all_agent_installations_are_refreshed_and_callable_in_bash_and_zsh() {
        let root = std::env::temp_dir().join(format!("vlx-all-agents-' 中文-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let prefix = root.join("nvm/prefix");
        std::fs::create_dir_all(&home).unwrap();
        let layout = |agent: &str| {
            let (bin, candidates, npm) = agent_layout_at(agent, &home)?;
            // Map host-wide Homebrew paths into the fixture, and exclude real user environment overrides.
            let mut candidates: Vec<_> = candidates.into_iter().filter(|path| path.starts_with(&root)).collect();
            if !npm && candidates.is_empty() { candidates.push(root.join("brew/bin").join(bin)); }
            Some((bin, candidates, npm))
        };
        let probes = std::cell::Cell::new(0);
        let prefixes = || { probes.set(probes.get() + 1); vec![prefix.clone()] };
        assert!(locate_installed_bins_with(layout, prefixes).is_empty());
        assert_eq!(probes.get(), 1, "one shared prefix lookup before installation");

        let mut kinds = Vec::new();
        for option in super::super::launch_options::catalog() {
            let Some((bin, candidates, npm)) = layout(option.id.as_str()) else { continue; };
            let path = if npm { npm_bin_candidate(&prefix, bin, false) } else { candidates[0].clone() };
            let script = if option.id == crate::models::SessionKind::Codex {
                // The command must also find Node beside the newly discovered npm wrapper.
                fixture_executable(&prefix.join("bin/node"), "#!/bin/sh\nprintf 'FIXTURE:codex\\n'\n");
                "#!/usr/bin/env node\n".to_string()
            } else {
                format!("#!/bin/sh\nprintf 'FIXTURE:{}\\n'\n", option.id.as_str())
            };
            fixture_executable(&path, &script);
            kinds.push(option.id);
        }
        assert_eq!(kinds.len(), 14);
        probes.set(0);
        let binaries = locate_installed_bins_with(layout, prefixes);
        assert_eq!(probes.get(), 1, "all npm agents share one prefix lookup");
        assert_eq!(binaries.len(), kinds.len(), "refresh sees every newly installed agent");
        std::fs::write(home.join(".bash_profile"), "export PATH=/usr/bin:/bin\n").unwrap();
        std::fs::write(home.join(".zprofile"), "export PATH=/usr/bin:/bin\n").unwrap();
        std::fs::write(home.join(".zlogin"), "export PATH=/usr/bin:/bin\n").unwrap();
        let script = kinds.iter().map(|kind| super::super::executable::command_name(*kind))
            .collect::<Vec<_>>().join("; ");
        let dirs = super::super::executable::binary_dirs(&binaries);
        let launch = format!("{} {script}", super::super::executable::path_startup_script(&dirs).trim_end());
        // Typed sessions retain Bash's native login startup and receive this single launch command afterwards.
        let output = std::process::Command::new("/bin/bash")
            .env_clear().env("HOME", &home).env("PATH", "/usr/bin:/bin")
            .args(["-lic", &launch]).output().unwrap();
        assert!(output.status.success());
        let output = String::from_utf8(output.stdout).unwrap();
        for kind in &kinds { assert!(output.contains(&format!("FIXTURE:{}\n", kind.as_str())), "{output}"); }
        for shell in ["/bin/bash", "/bin/zsh"] {
            if !std::path::Path::new(shell).exists() { continue; }
            let (state, _) = crate::pty::completion::install(&root, shell).unwrap().unwrap();
            let mut command = std::process::Command::new(shell);
            command.env_clear().env("HOME", &home).env("PATH", "/usr/bin:/bin");
            if shell.ends_with("bash") {
                let rcfile = crate::pty::completion::configure_bash_startup(&state, &binaries, None).unwrap();
                command.arg("--rcfile").arg(rcfile).args(["-ic", &script]);
            } else {
                let mut pty = portable_pty::CommandBuilder::new(shell);
                crate::pty::completion::configure_zsh_startup(&state, &mut pty, &binaries, None).unwrap();
                command.env("ZDOTDIR", pty.get_env("ZDOTDIR").unwrap()).args(["-lic", &script]);
            }
            let output = command.output().unwrap();
            assert!(output.status.success(), "{shell}: {}", String::from_utf8_lossy(&output.stderr));
            let output = String::from_utf8(output.stdout).unwrap();
            for kind in &kinds { assert!(output.contains(&format!("FIXTURE:{}\n", kind.as_str())), "{shell}: {output}"); }
            drop(state);
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn bashrc_only_npm_and_custom_agent_paths_are_detected_together() {
        let root = std::env::temp_dir().join(format!("vlx-bash-probe-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let prefix = root.join("nvm/prefix");
        let custom = root.join("custom/bin");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(root.join("empty")).unwrap();
        std::fs::write(home.join(".bash_profile"), format!("export PATH='{}'\n", root.join("empty").display())).unwrap();
        let shell = root.join("bash");
        fixture_executable(&shell, &format!("#!/bin/sh\nexec /usr/bin/env -i HOME='{}' PATH=/usr/bin:/bin /bin/bash \"$@\"\n", home.display()));
        let (prefixes, binaries, _) = shell_installations(shell.to_str().unwrap());
        assert!(prefixes.is_empty() && binaries.is_empty());

        fixture_executable(&prefix.join("bin/npm"), &format!("#!/bin/sh\nprintf '{}\\n'\n", prefix.display()));
        let mut expected = Vec::new();
        for option in super::super::launch_options::catalog() {
            if agent_layout_at(option.id.as_str(), &home).is_none() { continue; }
            let bin = custom.join(super::super::executable::command_name(option.id));
            fixture_executable(&bin, "#!/bin/sh\nexit 0\n");
            expected.push(bin.to_string_lossy().into_owned());
        }
        let noise = root.join("banner-only");
        fixture_executable(&noise, "#!/bin/sh\nexit 0\n");
        std::fs::write(home.join(".bashrc"), format!("printf '{}\\n'\nexport PATH='{}:{}'\n", noise.display(), prefix.join("bin").display(), custom.display())).unwrap();
        let (prefixes, mut binaries, _) = shell_installations(shell.to_str().unwrap());
        assert_eq!(prefixes, vec![prefix]);
        binaries.sort();
        expected.sort();
        assert_eq!(binaries, expected, "all 14 commands come from .bashrc, excluding the startup banner");
        std::fs::write(home.join(".bash_profile"), "source \"$HOME/.bashrc\"\n").unwrap();
        let (prefixes, mut binaries, _) = shell_installations(shell.to_str().unwrap());
        binaries.sort();
        assert_eq!(prefixes.len(), 1, "matching login and non-login prefixes are deduplicated");
        assert_eq!(binaries, expected);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn npm_layout_matches_the_host() {
        // The npm flag drives both candidate probing and dangling-wrapper detection, so it must follow
        // the platform conditions the recipes document.
        let win = cfg!(target_os = "windows");
        let mac = cfg!(target_os = "macos");
        let expected = [
            ("opencode", win),
            ("grok", win),
            ("crush", !mac),
            ("codex", true),
            ("copilot", true),
            ("cline", true),
            ("pi", true),
            ("claude", false),
            ("cursor", false),
            ("omp", false),
            ("antigravity", false),
            ("kimi", false),
            ("kiro", false),
            ("zoo", false),
        ];
        for (agent, npm) in expected {
            let (bin, _, use_npm) =
                agent_layout(agent).unwrap_or_else(|| panic!("no layout for {agent}"));
            assert!(!bin.is_empty(), "the command name for {agent} must not be empty");
            assert_eq!(use_npm, npm, "the npm flag for {agent} on this host");
        }
    }

    #[test]
    fn known_agents_have_nonempty_recipe() {
        for a in [
            "claude",
            "codex",
            "opencode",
            "copilot",
            "cursor",
            "antigravity",
            "cline",
            "pi",
            "omp",
            "crush",
        ] {
            let r = install_recipe(a).unwrap_or_else(|| panic!("no install recipe for {a}"));
            assert!(!r.command.is_empty(), "the install command for {a} must not be empty");
            assert!(!r.bin.is_empty(), "the bin for {a} must not be empty");
            assert!(r.docs_url.starts_with("https://"), "the documentation link for {a} should be https");
        }
    }

    #[test]
    fn omp_recipe_uses_the_official_installer() {
        // OMP ships a prebuilt binary through its own installer, so the recipe must not require Node, and its
        // binary name has to match the command inject.rs launches.
        let r = install_recipe("omp").unwrap();
        assert_eq!(r.bin, "omp");
        assert!(!r.needs_node, "OMP's installer downloads a binary and needs no Node");
        assert!(r.command.contains("omp.sh/install"), "the recipe should use the official installer");
    }

    #[test]
    fn pi_recipe_is_scoped_npm_package() {
        // Pi is scoped global npm only and its binary name matches inject.rs.
        let r = install_recipe("pi").unwrap();
        assert_eq!(r.bin, "pi");
        assert!(r.needs_node, "pi installs through npm, so Node is required first");
        assert!(
            r.command.contains("@earendil-works/pi-coding-agent"),
            "the pi install command should point at the scoped npm package"
        );
    }

    #[test]
    fn unknown_agent_has_no_recipe() {
        assert!(install_recipe("terminal").is_none());
        assert!(install_recipe("").is_none());
    }

    #[test]
    fn cursor_bin_is_cursor_agent() {
        // Binary names must match inject.rs, including cursor-agent.
        assert_eq!(install_recipe("cursor").unwrap().bin, "cursor-agent");
    }

    #[test]
    fn npm_candidate_layout_per_platform() {
        // Unix uses prefix/bin/name; Windows places the .cmd shim directly under prefix.
        let prefix = std::path::Path::new("/usr/local");
        assert_eq!(
            npm_bin_candidate(prefix, "codex", false),
            std::path::PathBuf::from("/usr/local/bin/codex")
        );
        // Build the Windows prefix/name.cmd expectation with path joins so Unix-hosted tests remain portable.
        let winp = std::path::Path::new(r"C:\Users\x\AppData\Roaming\npm");
        assert_eq!(
            npm_bin_candidate(winp, "codex", true),
            winp.join("codex.cmd")
        );
    }

    #[test]
    fn npm_recipes_allow_the_postinstall_that_creates_the_binary() {
        // Newer npm skips install scripts unless allowed; these packages produce their binary there.
        if cfg!(target_os = "windows") {
            let r = install_recipe("opencode").unwrap();
            assert_eq!(r.command, "npm install -g --allow-scripts=opencode-ai opencode-ai");
            let r = install_recipe("grok").unwrap();
            assert!(r.command.contains("--allow-scripts=@xai-official/grok"));
        }
        if !cfg!(target_os = "macos") {
            let r = install_recipe("crush").unwrap();
            assert!(r.command.contains("--allow-scripts=@charmland/crush"));
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_native_installers_are_probed_under_local_app_data() {
        // Cursor, OMP, and Antigravity install under %LOCALAPPDATA% on Windows, not ~/.local/bin.
        let local = local_app_data(&crate::host::home_dir().unwrap());
        let (_, cursor, _) = agent_layout("cursor").unwrap();
        assert_eq!(cursor[0], local.join("cursor-agent").join("cursor-agent.exe"));
        let (_, omp, _) = agent_layout("omp").unwrap();
        assert!(omp.contains(&local.join("omp").join("omp.exe")));
        let (_, agy, _) = agent_layout("antigravity").unwrap();
        assert_eq!(agy[0], local.join("agy").join("bin").join("agy.exe"));
    }

    #[test]
    fn exe_name_suffix() {
        assert_eq!(exe_name("claude", false), "claude");
        assert_eq!(exe_name("claude", true), "claude.exe");
    }

    #[test]
    fn locate_unknown_agent_is_none() {
        // Do not probe unknown or unguided types, matching install_recipe coverage.
        assert!(locate_installed_bin("terminal").is_none());
        assert!(locate_installed_bin("").is_none());
    }
}
