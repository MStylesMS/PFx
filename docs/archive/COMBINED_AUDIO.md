# Combined PulseAudio sink (combined_all / combined_hdmi_output)

This document explains how the "combined" PulseAudio sink works, whether it must be recreated at boot, and options for making it reliably available for PFx.

Checklist
- Explain whether the combined sink needs to be recreated on every boot: covered
- Explain options for making the combined sink persistent or created automatically: covered

How the combined sink works
- A combined sink is a virtual PulseAudio sink that forwards one input stream to multiple real sinks (for example HDMI0 and HDMI1).
- It is typically created at runtime by loading PulseAudio's module-combine-sink. Example (runtime) command:

  pactl load-module module-combine-sink sink_name=combined_all slaves=<hdmi0>,<hdmi1> sink_properties=device.description="Combined HDMI"

- When created, PulseAudio exposes a new sink (for example `combined_all` or `combined_hdmi_output`). Any application (mpv, PFx, etc.) can then play to that sink to output simultaneously to the slave sinks.

Persistence and lifecycle
- A module loaded with `pactl load-module` is transient. It exists only for the current PulseAudio daemon session.
  - If the machine reboots or the PulseAudio daemon restarts, the module is gone and must be recreated.
  - If hardware or sink names change between boots, the combined sink may point to non-existent slaves.

Ways to make the combined sink reliably present
1. Add to PulseAudio startup config (persistent):
   - Put a `load-module` line in the system or user PulseAudio config (for example `/etc/pulse/default.pa` or `~/.config/pulse/default.pa`). PulseAudio will load it at startup.
   - Downside: the slave sink names must be correct and available at the time PulseAudio loads. If hardware is not yet ready, the module may fail to load or attach incorrectly.

2. Create it at boot with a startup script or systemd unit:
   - Run a discovery script (for example `pi-audio-discovery.sh`) at boot, after PulseAudio and the audio hardware are up, to discover the correct sink names and call `pactl load-module ...`.
   - This is robust: the script can wait/retry until sinks appear and create the combined sink using discovered names.

3. Create it dynamically from the application (PFx) at startup:
   - Have PFx detect sinks at startup and load the module if needed. This guarantees the sink exists while the app runs and allows recreation if PulseAudio restarts.

4. Handle PulseAudio restarts:
   - If PulseAudio restarts after the combined sink was created, the module is lost. Use one of the above approaches in a way that runs again (e.g., systemd unit that watches PulseAudio or app-level recreation) to maintain availability.

Operational notes and caveats
- Device name stability: HDMI sink names (PulseAudio sink identifiers) can change between boots. Use discovery logic that matches sinks by properties (device properties or description) rather than hardcoding fragile names.
- Timing: Ensure the combined sink is created after PulseAudio has enumerated real sinks. A creation script should wait and retry for a short time.
- Latency and sync: module-combine-sink duplicates streams to slaves. Different hardware may introduce small sync offsets. For two identical HDMI outputs this is usually acceptable, but test for echo or lip-sync issues.
- Cleanup and duplicates: Repeatedly creating the same combined sink can result in duplicates. Consider unloading old modules (via `pactl unload-module <id>`) before creating a new one, or check whether a sink with the desired name already exists.

Recommendation
- If PFx must always be able to play to a combined HDMI sink, use a small startup script or a PFx startup check that:
  1. Discovers the correct slave sink names (robust matching by properties).
  2. Creates the combined sink with `pactl load-module module-combine-sink ...` if it does not already exist.
  3. Optionally unloads/recreates the module if slave sinks change or PulseAudio restarts.

- Persisting a `load-module` entry in PulseAudio config is fine only when slave sink names are stable and guaranteed to be available before PulseAudio starts. The discovery/script approach is generally more robust on Pi hardware.

Next steps (optional)
- I can show the exact `pactl load-module` command your discovery script uses (no code changes).
- I can add a small `systemd` unit or a boot script that runs `pi-audio-discovery.sh` after PulseAudio/hardware become available to ensure the combined sink exists on boot.

