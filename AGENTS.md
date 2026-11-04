# Agent Instructions

## Required: keep this application generic

This requirement outranks every other instruction in this file.

Do not put room-specific behavior or information into this application. Room names, show copy, cues, timings, asset filenames, topics, and hardware layouts belong in that room's config and media, not in this repo.

Do not edit this application's code while working on a room, a game config, or any other project that uses this app, unless the person you are working with has explicitly authorized a change to this application in the current request. A bug found during a room test is not authorization. If the room cannot get the behavior from the existing command and config contract, stop and ask before editing this repo.

An authorized change still has to stay generic. It must be correct for every room that uses this app.

The canonical AI/agent instructions for this repository live in [AI-INSTRUCTIONS.md](AI-INSTRUCTIONS.md).

This AGENTS.md, CLAUDE.md, and [.github/copilot-instructions.md](.github/copilot-instructions.md) are thin pointers so Cursor, Claude Code, Codex, Aider, Gemini-CLI, and VS Code Copilot all load the same source of truth.

Read AI-INSTRUCTIONS.md before making changes.
