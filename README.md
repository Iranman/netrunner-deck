# Netrunner Deck

A Cyberpunk-styled side pane for Claude Code that shows what your session is doing, live.

- **Subagent cards**: each running subagent gets a card with its type, model tier (`[HAIKU]`, `[SONNET]`, `[OPUS]`), task, the tool it is running right now and the ones it finished. Finished agents shrink to one line.
- **Side-by-side diff**: the latest Edit or Write, from the main session or any subagent, as BEFORE │ AFTER with added/removed counts. Long lines wrap.
- **Resource meter**: CPU (with a sparkline), RAM and GPU used by the Claude session and everything it started (MCP servers, shells).
- **Highlights**: key points (lines starting `Key:`) and questions for you are drawn as callout boxes in the transcript; the mod tells Claude to write them that way.
- **Sound FX**: a sound when a subagent jacks in, finishes or fails. `/deck-sfx` toggles them.

`/deck` reopens the pane. It docks beside the transcript at up to 45% of the terminal width.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install netrunner-deck --marketplace Iranman/netrunner-deck
```

Answer `y` to add the marketplace, then pick a scope (user scope puts the deck in every session). From a shell instead:

```
claude plugin install netrunner-deck --marketplace Iranman/netrunner-deck
```

## Requirements

Windows for the resource meter (`bin/stats.ps1`) and sound effects, which use Windows PowerShell. On macOS or Linux the pane, diffs and highlights still work, without stats or sounds.

## License

MIT
