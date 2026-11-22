# Issue tracking

Adopted version: `github-tracking-v1`, slimmed down for a repository with one developer. This
document is complete without the template.

## Where

GitHub issues in `dom8509/pi-workflow-status`, read and written with the `gh` CLI. There is no
separate implementation plan; the scope lives in the issue. Status lives only in GitHub.

## Roles

- User: approves scope and plan, accepts results, approves merges and scope changes.
- Agent: implements the issue within the approved scope and records evidence in the issue and the
  pull request.

## Required fields of an implementation issue

Issue form `.github/ISSUE_TEMPLATE/implementation.yml`: goal and context, scope and exclusions,
acceptance criteria with an id (`AC1`, `AC2`, …) and the kind of evidence for each, whether user
acceptance is required (yes/no).

## Reading lists

Every read of a list reads all pages: `gh api --paginate`, or `gh issue list` with a `--limit`
above the total.

## Closing

- Commits and pull request descriptions refer to issues with `Refs #<number>`. `Closes`, `Fixes`
  and `Resolves` stay out, because GitHub would otherwise close the issue on merge.
- The pull request description has an evidence table with one row per acceptance criterion and a
  line "Pending acceptance".
- An issue closes only when every acceptance criterion is proven in the issue and the required
  user acceptance is recorded. An open or unproven criterion keeps it open; the closing comment
  names it.
- A manual test is a comment with date, build (commit SHA), environment (Orca version), tester,
  result per criterion and artifact (screenshot).
