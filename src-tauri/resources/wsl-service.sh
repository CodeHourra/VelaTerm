#!/bin/sh
# Invoked through wsl.exe with this script on stdin. Parameters are assigned by the Rust caller;
# credentials never enter the process command line. Only this workspace's service is managed.
set -eu
umask 077
case "$namespace:$version" in *[!a-zA-Z0-9_.:-]*) echo 'Invalid WSL service identity' >&2; exit 1;; esac
root="$HOME/.velaterm/wsl/$namespace"
mkdir -p "$root"
chmod 700 "$root"
root=$(cd "$root" && pwd -P)
command -v flock >/dev/null || { echo 'WSL requires flock (util-linux)' >&2; exit 1; }
exec 9>"$root/lock"
flock -w 30 9 || { echo 'The WSL workspace is busy; try again' >&2; exit 1; }

port=0
password=''
if [ -f "$root/config" ]; then
    { read -r port; read -r password; } <"$root/config"
    case "$port" in ''|*[!0-9]*) echo 'Invalid WSL port configuration' >&2; exit 1;; esac
    case "$password" in ''|*[!a-zA-Z0-9]*) echo 'Invalid WSL credential configuration' >&2; exit 1;; esac
    [ "$port" -ge 10000 ] && [ "$port" -le 49151 ] || { echo 'Invalid WSL port range' >&2; exit 1; }
    [ "${#password}" -ge 32 ] || { echo 'Invalid WSL credential configuration' >&2; exit 1; }
    chmod 600 "$root/config"
fi
pid=0
stamp=0
active_version="$version"
created=false
if [ -f "$root/run" ]; then
    { read -r pid; read -r stamp; read -r active_version; } <"$root/run"
    case "$pid:$stamp" in *[!0-9:]*) echo 'Invalid WSL process record' >&2; exit 1;; esac
    case "$active_version" in ''|*[!a-zA-Z0-9_.-]*) echo 'Invalid WSL version record' >&2; exit 1;; esac
fi

process_stamp() {
    # The comm field may contain spaces and parentheses; starttime is field 20 after the final ') '.
    awk '{sub(/.*\) /, ""); print $20}' "/proc/$1/stat" 2>/dev/null
}
alive() {
    [ "$pid" -gt 1 ] && [ "$stamp" != 0 ] &&
        [ "$(readlink "/proc/$pid/exe" 2>/dev/null)" = "$root/versions/$active_version/vela-server" ] &&
        [ "$(process_stamp "$pid")" = "$stamp" ] && kill -0 "$pid" 2>/dev/null
}
status() {
    running=false
    if alive; then running=true; fi
    printf '{"port":%s,"password":"%s","pid":%s,"stamp":"%s","version":"%s","running":%s,"created":%s}\n' \
        "$port" "$password" "$pid" "$stamp" "$active_version" "$running" "$created"
}
port_free() {
    hex=$(printf '%04X' "$1")
    # Check all addresses, including IPv6 wildcard listeners, before using a loopback port.
    set -- /proc/net/tcp
    if [ -r /proc/net/tcp6 ]; then set -- "$@" /proc/net/tcp6; fi
    awk -v p="$hex" '$4 == "0A" {split($2,a,":"); if (a[2] == p) found=1} END {exit found ? 1 : 0}' \
        "$@"
}

case "$operation" in
    status) status ;;
    port)
        if port_free "$candidate"; then printf 'free\n'; else printf 'busy\n'; fi
        ;;
    install)
        destination="$root/versions/$version/vela-server"
        if [ -f "$destination" ] && [ "$(sha256sum "$destination" | awk '{print $1}')" = "$sha" ]; then
            printf 'ready\n'; exit 0
        fi
        if alive && [ "$active_version" = "$version" ]; then
            echo 'Stop the running WSL server before replacing its executable' >&2; exit 1
        fi
        source_linux=$(wslpath -a -u "$source")
        mkdir -p "$root/versions/$version"
        temporary="$destination.install-$$"
        trap 'rm -f "$temporary"' EXIT HUP INT TERM
        cp -- "$source_linux" "$temporary"
        [ "$(sha256sum "$temporary" | awk '{print $1}')" = "$sha" ] || {
            echo 'WSL server checksum verification failed' >&2; exit 1
        }
        chmod 700 "$temporary"
        mv -f -- "$temporary" "$destination"
        printf 'ready\n'
        ;;
    start)
        if alive; then status; exit 0; fi
        port_free "$candidate" || { echo 'The selected WSL port is occupied; connect again' >&2; exit 1; }
        if [ -z "$password" ]; then password="$new_password"; fi
        port="$candidate"
        printf '%s\n%s\n' "$port" "$password" >"$root/config.tmp"
        mv -f "$root/config.tmp" "$root/config"
        mkdir -p "$root/data"
        active_version="$version"
        binary="$root/versions/$version/vela-server"
        [ -x "$binary" ] || { echo 'The Linux WSL server executable is missing' >&2; exit 1; }
        # A Windows launch must not skip the server's login-shell environment import because of TERM.
        # Resolve the Linux user's shell so nvm and other profile-only installations remain discoverable.
        if command -v getent >/dev/null; then
            login_shell=$(getent passwd "$(id -u)" | awk -F: '{print $7}')
            if [ -n "$login_shell" ]; then SHELL="$login_shell"; export SHELL; fi
        fi
        unset TERM VLX_EXE VLX_BIN_DIR VLX_SESSION_ID VLX_SPAWN_URL VLX_SPAWN_TOKEN
        VELA_SERVE_PASSWORD="$password"; export VELA_SERVE_PASSWORD
        cd "$HOME"
        # Close the flock descriptor in the daemon, otherwise a running service would lock out reconnects.
        nohup "$binary" --serve --local-http --port "$port" --data-dir "$root/data" --mirror 0 \
            </dev/null >"$root/server.log" 2>&1 9>&- &
        pid=$!
        stamp=$(process_stamp "$pid")
        [ -n "$stamp" ] || { echo 'The WSL server exited during startup; see its server.log' >&2; exit 1; }
        printf '%s\n%s\n%s\n' "$pid" "$stamp" "$version" >"$root/run.tmp"
        mv -f "$root/run.tmp" "$root/run"
        created=true
        # exec may not have happened yet; the caller verifies identity and readiness before opening a window.
        status
        ;;
    stop)
        # Require the identity captured by this connection, in addition to the executable and start time.
        if [ "$pid" != "$expected_pid" ] || [ "$stamp" != "$expected_stamp" ]; then
            echo 'The WSL server changed; reconnect before stopping it' >&2; exit 1
        fi
        if alive; then
            # Capture descendants before the server exits and they are reparented. A start-time check
            # on every signal prevents PID reuse from affecting another process.
            awk -v root_pid="$pid" '{
                n=$1; sub(/.*\) /, ""); split($0,f," "); parent[n]=f[2]; started[n]=f[20]
            } END {
                for (n in parent) {
                    p=n; depth=0
                    while (p in parent && p != root_pid && depth++ < 256) p=parent[p]
                    if (p == root_pid && n != root_pid) print n,started[n]
                }
            }' /proc/[0-9]*/stat 2>/dev/null >"$root/stopping" || true
            kill -TERM "$pid"
            while read -r child child_stamp; do
                if [ "$(process_stamp "$child")" = "$child_stamp" ]; then kill -TERM "$child" 2>/dev/null || true; fi
            done <"$root/stopping"
            attempts=0
            while alive && [ "$attempts" -lt 100 ]; do sleep 0.1; attempts=$((attempts + 1)); done
            if alive; then echo 'The WSL server is still stopping; try again' >&2; exit 1; fi
            while read -r child child_stamp; do
                if [ "$(process_stamp "$child")" = "$child_stamp" ]; then kill -KILL "$child" 2>/dev/null || true; fi
            done <"$root/stopping"
            rm -f "$root/stopping"
        fi
        rm -f "$root/run"
        printf 'stopped\n'
        ;;
    *) echo 'Invalid WSL service operation' >&2; exit 1 ;;
esac
