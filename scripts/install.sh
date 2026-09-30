#!/bin/sh
# VelaTerm server installer.
#
#   curl -fsSL https://dl.velaterm.com/server/install.sh | sh
#
# Downloads the vela-server release for this machine, verifies it and installs it for the current user
# (no root needed). Afterwards `~/.velaterm/bin/vela-server` links the machine to a VelaTerm account and
# serves it through the account relay, so it can be managed from another computer without SSH.
#
# Written for POSIX sh (dash, busybox ash) because minimal containers and WSL images have no bash.
#
# Environment:
#   VELA_VERSION       Install this version instead of the latest release.
#   VELA_INSTALL_DIR   Install directory (default: ~/.velaterm/bin).
#   VELA_DL_BASE       Download origin, for an internal mirror (default: https://dl.velaterm.com).
#
# Verification: the SHA-256 in the release manifest is always checked. The minisign signature is checked
# with `minisign` or OpenSSL 1.1.1+ (Ed25519, BLAKE2b) when either is present; the key is the same updater
# key embedded in VelaTerm. Without both, the installer says so and relies on the HTTPS download only.
set -eu

DL_BASE="${VELA_DL_BASE:-https://dl.velaterm.com}"
ROOT="$HOME/.velaterm"
INSTALL_DIR="${VELA_INSTALL_DIR:-$ROOT/bin}"
# Two-line minisign public key, base64 as embedded in src-tauri/src/server_supply.rs.
PUBKEY_B64="dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg3QkY3RjE5NjU5NEIzN0YKUldSL3M1UmxHWCsvaDF4bkdReURmL2FLV2ZRbDU1V0xyRGV0dHZwQnBibWxPU3pGdXRjc2x4eCsK"

say() { printf '%s\n' "$*"; }
die() { printf 'vela-server install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

fetch() {   # <url> <output file>
  if have curl; then
    curl -fsSL --proto '=https' --tlsv1.2 "$1" -o "$2"
  elif have wget; then
    wget -q -O "$2" "$1"
  else
    die "curl or wget is required"
  fi
}

b64decode() {   # stdin → stdout
  if printf 'dGVzdA==' | base64 -d >/dev/null 2>&1; then
    base64 -d
  elif printf 'dGVzdA==' | base64 -D >/dev/null 2>&1; then
    base64 -D
  elif have openssl; then
    openssl base64 -d -A
  else
    die "base64 or openssl is required"
  fi
}

sha256_of() {   # <file>
  if have sha256sum; then
    sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif have openssl; then
    openssl dgst -sha256 "$1" | sed 's/.*= *//'
  else
    die "sha256sum, shasum or openssl is required"
  fi
}

hex_of() {   # <file> <skip> <count>: bytes as lowercase hex
  dd if="$1" bs=1 skip="$2" count="$3" 2>/dev/null | od -An -v -tx1 | tr -d ' \n'
}

# ---- Platform -------------------------------------------------------------
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "unsupported system: $(uname -s). vela-server runs on Linux and macOS; on Windows, install it inside WSL." ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x86_64 ;;
  aarch64|arm64) arch=aarch64 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac
if [ "$os" = linux ]; then
  if ldd --version 2>&1 | grep -qi musl || ls /lib/ld-musl-* >/dev/null 2>&1; then
    die "this system uses musl (for example Alpine). vela-server needs glibc 2.17 or later, as on Debian, Ubuntu or CentOS 7+."
  fi
fi
key="$os-$arch"

mkdir -p "$ROOT" "$INSTALL_DIR"
work="$(mktemp -d "$ROOT/.install.XXXXXX")"
trap 'rm -rf "$work"' EXIT INT TERM

# ---- Version ----------------------------------------------------------------
version="${VELA_VERSION:-}"
version="${version#v}"
if [ -z "$version" ]; then
  if fetch "$DL_BASE/server/latest.json" "$work/latest.json" 2>/dev/null; then :; else
    fetch "$DL_BASE/latest.json" "$work/latest.json" || die "cannot reach $DL_BASE"
  fi
  version="$(tr -d '\n' < "$work/latest.json" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$version" ] || die "cannot determine the latest version"
fi
case "$version" in *[!0-9A-Za-z.+-]*) die "invalid version: $version" ;; esac

# ---- Manifest -------------------------------------------------------------
say "Installing vela-server $version for ${key}…"
fetch "$DL_BASE/server/$version/server-manifest.json" "$work/manifest.json" \
  || die "release $version was not found"
entry="$(tr -d '\n' < "$work/manifest.json" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/p")"
[ -n "$entry" ] || die "release $version has no build for $key"
field() { printf '%s' "$entry" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"; }
url="$(field url)"
sha256="$(field sha256 | tr 'A-F' 'a-f')"
signature="$(field signature)"
[ -n "$url" ] && [ -n "$sha256" ] && [ -n "$signature" ] || die "the release manifest is incomplete"
case "$url" in
  https://dl.velaterm.com/*|"$DL_BASE"/*) ;;
  *) die "unexpected download location: $url" ;;
esac

# ---- Download and verify ----------------------------------------------------
fetch "$url" "$work/vela-server" || die "download failed"
[ "$(sha256_of "$work/vela-server")" = "$sha256" ] || die "checksum mismatch; nothing was installed"

printf '%s' "$PUBKEY_B64" | b64decode > "$work/key.pub"
printf '%s' "$signature" | b64decode > "$work/vela-server.minisig"
verified=""
if have minisign; then
  minisign -Vq -m "$work/vela-server" -p "$work/key.pub" -x "$work/vela-server.minisig" \
    || die "signature verification failed; nothing was installed"
  verified="minisign"
elif have openssl && openssl dgst -blake2b512 </dev/null >/dev/null 2>&1 \
    && openssl list -public-key-algorithms 2>/dev/null | grep -qi ed25519; then
  sed -n 2p "$work/key.pub" | b64decode > "$work/key.bin"
  sed -n 2p "$work/vela-server.minisig" | b64decode > "$work/sig.bin"
  [ "$(wc -c < "$work/key.bin" | tr -d ' ')" = 42 ] && [ "$(wc -c < "$work/sig.bin" | tr -d ' ')" = 74 ] \
    || die "invalid signature format"
  [ "$(hex_of "$work/key.bin" 2 8)" = "$(hex_of "$work/sig.bin" 2 8)" ] \
    || die "the release was signed with a different key; nothing was installed"
  case "$(hex_of "$work/sig.bin" 0 2)" in
    4544) openssl dgst -blake2b512 -binary "$work/vela-server" > "$work/message" ;;   # "ED": prehashed
    4564) cp "$work/vela-server" "$work/message" ;;                                   # "Ed": legacy
    *) die "unsupported signature algorithm" ;;
  esac
  # Ed25519 SubjectPublicKeyInfo (RFC 8410) prefix, then the 32-byte key.
  printf '\060\052\060\005\006\003\053\145\160\003\041\000' > "$work/key.der"
  dd if="$work/key.bin" bs=1 skip=10 count=32 2>/dev/null >> "$work/key.der"
  dd if="$work/sig.bin" bs=1 skip=10 count=64 2>/dev/null > "$work/sig.raw"
  openssl pkeyutl -verify -pubin -keyform DER -inkey "$work/key.der" -rawin \
    -in "$work/message" -sigfile "$work/sig.raw" >/dev/null 2>&1 \
    || die "signature verification failed; nothing was installed"
  verified="OpenSSL"
fi

# ---- Install ----------------------------------------------------------------
chmod 755 "$work/vela-server"
mv -f "$work/vela-server" "$INSTALL_DIR/vela-server"
bin="$INSTALL_DIR/vela-server"
if [ -d "$HOME/.local/bin" ]; then
  case ":$PATH:" in *":$HOME/.local/bin:"*) ln -sf "$bin" "$HOME/.local/bin/vela-server" && bin="vela-server" ;; esac
fi

say ""
if [ -n "$verified" ]; then
  say "Installed vela-server $version to $INSTALL_DIR (checksum and signature verified with $verified)."
else
  say "Installed vela-server $version to $INSTALL_DIR (checksum verified; install minisign or OpenSSL 1.1.1+ to also verify the signature)."
fi
say ""
say "Next, link this machine to your VelaTerm account and start it:"
say ""
say "  $bin"
say ""
