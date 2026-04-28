# PR: Licensing and Commercial Distribution Strategy

## Background: Options Considered

This document summarizes the strategic options evaluated before arriving at the hybrid licensing approach. It provides context for why we chose to invest in a native licensing layer rather than a full platform rewrite or port.

---

### Option 1: Native TV Platform App (Apple TV / Android TV / Fire TV / Roku / Samsung / LG)

Build a new, purpose-built application targeting consumer TV platforms, using each platform's native SDK with MQTT for remote control.

**Pros**
- Access to consumer app store billing (Apple StoreKit, Google Play, Amazon IAP)
- Professional rendering pipelines, GPU-accelerated crossfade (especially Apple TV 4K)
- No Linux dependency; hardware is maintained by the vendor
- Subscription billing built in to platform store

**Cons**
- Separate codebases per platform (Swift/tvOS, Kotlin/Android TV, Fire OS, BrightScript)
- Store approval processes, commission fees (15–30%), platform policy constraints
- Roku: poor animation performance, no native video crossfade
- Samsung/LG: fragmented certification requirements, limited direct billing documentation
- Loses existing INI/EDN config ecosystem; major re-architecture required
- Hardware crossfade only guaranteed on Apple TV 4K and select Android TV hardware

**Conclusion**: Viable for a greenfield consumer product but a large investment requiring platform-specific teams and irreversible ecosystem divergence.

---

### Option 2: Rewrite PFx in C++ or Rust

Replace the Node.js runtime with a compiled binary that meets the same MQTT API and hardware capabilities.

**Pros**
- True compiled binary — harder to copy or reverse-engineer than Node.js
- Potential memory and startup time improvements
- Rust brings memory safety, strong type system, and reliable daemon behavior
- C++ has the deepest multimedia ecosystem (FFmpeg, GStreamer, libvlc)

**Cons**
- Node.js is **not** the bottleneck — the heavy work is already in mpv, PulseAudio, and X11
- A 1:1 rewrite only gains protection, not performance; the architecture boundary doesn't change
- Large engineering investment for systems that are currently stable
- Rust async ecosystem for multimedia is still maturing
- Loses rapid iteration advantage of Node.js for config-driven logic

**Conclusion**: Worthwhile only if paired with an architecture shift (e.g., moving media decode or license validation into native code). Not justified as a direct port.

---

### Option 3: Non-Pi Devices

Evaluate cheap alternatives to Raspberry Pi for deployment targets.

| Device Class | Notes |
|---|---|
| Raspberry Pi Zero 2W | Too underpowered for multi-zone audio + video |
| Raspberry Pi 3B+ | Minimum viable floor; no simultaneous multi-stream video |
| **Raspberry Pi 4 (2GB+)** | **Recommended minimum for PFx deployment** |
| Raspberry Pi 5 | Best Pi option; hardware video decode, faster I/O |
| x86 Thin Client (e.g., HP t630, Wyse 5070) | More CPU/RAM for same price; no Pi supply chain risk; larger form factor |
| Intel NUC | Over-spec for most use cases; higher cost |

**Conclusion**: Pi 4 remains the recommended floor. x86 thin clients are a viable alternative for venues where size is not a constraint. Pi Zero class is excluded from PFx capability targets.

---

## Recommended Approach: Hybrid Binary Licensing Layer

Rather than a full rewrite or platform port, the recommended strategy is to **surgically extract the highest-value logic into native compiled binaries** while keeping the orchestration layer in Node.js. This provides IP protection and a licensable unit without throwing away the existing working system.

### Core Principle

The system is divided into two planes:

- **Orchestration Plane** (remains in Node.js): MQTT routing, config parsing, zone management, logging
- **Native Services Plane** (compiled binaries): license validation, media engine, signed content packages

The native services are exposed over local IPC (Unix sockets or gRPC) and are called by the JS orchestration layer. They are compiled, stripped, and signed before distribution.

---

### Priority Modules for Native Compilation

#### 1. License and Entitlement Engine (`license-engine`)
- Hardware fingerprinting (Pi serial, MAC address, CPUID)
- Offline activation tokens with expiry and feature flags
- Online lease renewal and revocation check
- Signed JWT/binary token validation
- **Why first**: This is the primary anti-copy lever. Without it, any other protection is moot.

#### 2. Media Playback Engine (`media-engine`)
- Manages mpv IPC lifecycle, crossfade coordination, transition queue
- Exposes a clean local API that replaces the current `audio-manager.js` / `mpv-zone-manager.js` surface
- Compiled against FFmpeg/mpv for deterministic behavior
- **Why second**: Highest performance sensitivity; native transitions enable features (crossfade) not possible from JS

#### 3. Package Runtime Engine (`package-engine`)
- Reads signed + optionally encrypted media/config bundles
- Validates bundle signatures before allowing playback or config load
- Issues per-install content licenses tied to the license-engine token
- **Why third**: Makes piracy of content and configs meaningfully harder; enables per-room content licensing

---

### Application Across Paradox Products

#### ParadoxFX (PFx)
- Consumes `license-engine` at startup; refuses to operate without valid license token
- `media-engine` replaces the current JS mpv wrapper; PFx JS layer retains MQTT routing only
- `package-engine` validates all media bundles before playback
- Distribution: compiled `.deb` or tarball with signed binary + JS orchestration

#### PxO (Paradox Orchestrator)
- Consumes `license-engine` at startup; feature flags control which game modes are available per license tier
- EDN config loader can optionally validate a bundle signature (via `package-engine`) to prevent config tampering
- Sequence runner and game state machine remain in JS (not a performance bottleneck)
- Distribution: Node.js bundle + `license-engine` binary; EDN configs optionally signed

#### PxC (Paradox Clock)
- Lightest product; primary protection is the `license-engine` check at kiosk startup
- React bundle can be wrapped in an Electron shell with the `license-engine` binary embedded in the main process
- Clock styles and assets can be distributed as signed `package-engine` bundles (per-venue content)
- Distribution: Electron app bundle with embedded license check + signed asset packages

#### PxT (Paradox Terminal)
- Already Electron-based; most natural fit for the hybrid model
- `license-engine` runs as a sidecar process or is embedded in the Electron main process via native addon
- Game content (emails, files, images) distributed as signed `package-engine` bundles
- Feature flags can gate gameplay modes (e.g., single-puzzle vs. full terminal access) per license tier
- Distribution: signed Electron app + encrypted content bundles

---

### Licensing Tiers (Illustrative)

| Tier | Features | Target |
|---|---|---|
| **Venue** | Single-room, single-device activation | Independent operators |
| **Multi-Room** | Up to N rooms per license | Venue chains |
| **Subscription** | Monthly/annual lease, remote revocation | SaaS / recurring model |
| **OEM/White-Label** | Custom branding, bundle signing keys | Resellers / integrators |

---

### What This Does NOT Protect

- Determined reverse engineers with physical device access can always extract binaries
- Open-source components (mpv, PulseAudio, MQTT) remain freely available
- The EDN/INI config format itself is not a secret

**The goal is not perfect DRM** — it is raising the cost of casual copying above the value of the effort, and enabling commercial enforcement through license tokens.