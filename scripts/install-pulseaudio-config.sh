#!/usr/bin/env bash
# Install PulseAudio config to prevent analog sink auto-suspend on Raspberry Pi.
# Idempotent — safe to run from configure-audio-levels.sh on every pfx start.
#
# See docs/AUDIO_SILENT_PLAYBACK.md

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PFX_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DROPIN_SRC="${PFX_ROOT}/config/pulse/paradox-no-suspend.pa"
DROPIN_NAME="paradox-no-suspend.pa"
MARKER="# Paradox PFx: disable suspend-on-idle"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

log() {
    logger -t paradox-pulse -p daemon.info "$*"
}

warn() {
    logger -t paradox-pulse -p daemon.warning "$*"
}

if [[ ! -f "${DROPIN_SRC}" ]]; then
    warn "Missing PulseAudio drop-in: ${DROPIN_SRC}"
    exit 0
fi

# User-level override (no sudo): include system default.pa then unload suspend module
user_pa_dir="${HOME}/.config/pulse"
user_pa_file="${user_pa_dir}/default.pa"
user_dropin_dir="${user_pa_dir}/default.pa.d"

mkdir -p "${user_dropin_dir}"
if ! cmp -s "${DROPIN_SRC}" "${user_dropin_dir}/${DROPIN_NAME}" 2>/dev/null; then
    install -m 644 "${DROPIN_SRC}" "${user_dropin_dir}/${DROPIN_NAME}"
    log "Installed ${user_dropin_dir}/${DROPIN_NAME}"
fi

if [[ ! -f "${user_pa_file}" ]] || ! grep -qF "${MARKER}" "${user_pa_file}" 2>/dev/null; then
    mkdir -p "${user_pa_dir}"
    if [[ -f "${user_pa_file}" ]]; then
        {
            echo ""
            echo "${MARKER}"
            echo ".nofail"
            echo ".include default.pa.d/${DROPIN_NAME}"
            echo ".fail"
        } >> "${user_pa_file}"
    else
        cat > "${user_pa_file}" <<EOF
# Paradox PFx user PulseAudio config
.include /etc/pulse/default.pa
${MARKER}
.nofail
.include default.pa.d/${DROPIN_NAME}
.fail
EOF
    fi
    log "Updated ${user_pa_file}"
fi

# System-wide drop-in when sudo is available (persists across users)
etc_dropin="/etc/pulse/default.pa.d/${DROPIN_NAME}"
if [[ -w "/etc/pulse/default.pa.d" ]] 2>/dev/null || sudo -n true 2>/dev/null; then
    if ! cmp -s "${DROPIN_SRC}" "${etc_dropin}" 2>/dev/null; then
        if sudo -n install -m 644 "${DROPIN_SRC}" "${etc_dropin}" 2>/dev/null; then
            log "Installed ${etc_dropin}"
        fi
    fi
fi

# Immediate effect without restarting PulseAudio (no-op if already unloaded)
if command -v pactl >/dev/null 2>&1 && pactl info >/dev/null 2>&1; then
    if pactl list modules short 2>/dev/null | grep -q 'module-suspend-on-idle'; then
        if pactl unload-module module-suspend-on-idle 2>&1 | logger -t paradox-pulse -p daemon.info; then
            log "Unloaded module-suspend-on-idle via pactl"
        else
            warn "Failed to unload module-suspend-on-idle via pactl"
        fi
    fi
fi

exit 0
