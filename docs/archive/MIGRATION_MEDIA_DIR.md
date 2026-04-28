# Migration: media_base_path → media_dir

This short note explains the recent configuration change in ParadoxFX (PFx): the global `media_base_path` is deprecated.

Why
- Previously PFx allowed a single `media_base_path` in `[global]` and per-device `media_path` values to be resolved relative to that base.
- This caused surprising inheritance and made per-zone deployments harder to reason about.

What changed
- PFx now treats `media_dir` (per device) as the canonical media directory for that device.
  - If `media_dir` is absolute (starts with `/`) it is used as-is.
  - If `media_dir` is relative, PFx resolves it relative to `/opt/paradox/media` (the default base).
- Global `media_base_path` is deprecated and ignored for per-zone resolution. It may still exist in old configs but will not affect runtime per-zone `media_dir` resolution.

How to migrate
1. Replace global `media_base_path` with per-device `media_dir` entries.

Example (old)
```
[global]
media_base_path = /opt/paradox/media

[screen:zone1]
media_path = zone1
```

Equivalent new configuration
```
[screen:zone1]
media_dir = /opt/paradox/media/zone1    ; absolute path
```

Or, use a relative media_dir (resolved to `/opt/paradox/media/zone1`):
```
[screen:zone1]
media_dir = zone1
```

Best practices
- Prefer absolute `media_dir` paths when you manage media outside the default `/opt/paradox/media` tree.
- For shared deployments keep per-zone `media_dir` values in local `pfx.ini` files and avoid committing sensitive paths to repositories.
- If your existing configs rely on a global `media_base_path`, update them now and remove the global key; PFx will continue to run but will not use that global value for per-zone resolution.

If you want, I can automatically update example INI files and local `/opt/paradox/config/pfx-*.ini` files to remove `media_base_path` and show how to write `media_dir` values — say the word and I will proceed to apply edits and run tests.
