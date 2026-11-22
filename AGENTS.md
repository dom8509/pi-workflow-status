# pi-workflow-status

Orca plugin that shows the Pi workflow and stage of every agent. Structure and commands are in
`README.md`; Orca's plugin rules come from `orca skills get orca-plugin-authoring`.

## Tracking

GitHub issues in `dom8509/pi-workflow-status`, rules in `docs/agents/issue-tracker.md`.

## Definition of done

An issue is done when every acceptance criterion is proven on its own, with the command and its
output. At least these must pass:

```sh
orca plugin test . --json
orca plugin validate . --json
```

New or changed capabilities in `orca-plugin.json` need a new approval in Orca; the pull request
description lists them.

## Language

Everything in this repository is English: code, comments, documents, issues, commits, pull
requests and the plugin's interface.
