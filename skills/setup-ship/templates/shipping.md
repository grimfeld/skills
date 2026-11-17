# Shipping

How work gets from a branch to __DEFAULT_BRANCH__ in this repository. Written by `/ship:setup-ship`; the
`ship` plugin's skills (`pr-review`, `night-shift`) read it. Keep it true when the process changes.

## The rule

A PR reaches `__DEFAULT_BRANCH__` only after a person has reviewed it and added the **`ship`** label.
Nothing else merges: the `ship` commit status is required by the ruleset on `__DEFAULT_BRANCH__`, and it stays
pending until the label is on.

1. An agent opens the PR as a **draft** while it works.
2. It marks the PR ready only when local checks pass, `/ship:pr-review` has run (label `pr-reviewed`) and the
   review section is in the description.
3. You read the review section, and add `ship` or leave a comment.
4. `.github/workflows/ship.yml` lands it: __LANDING_SUMMARY__

Dependabot patch updates and GitHub Actions updates get `ship` without review.

## Landing

- **Mode:** __LAND_MODE__
- **Merge method:** __MERGE_METHOD__
__LAND_DETAILS__

## Checks

Required on `__DEFAULT_BRANCH__`: __REQUIRED_CHECKS__, and `ship`.

Run locally before marking a PR ready: __LOCAL_CHECKS__

## After merge

__CD_SUMMARY__

## Screens

Command that produces screenshots of the screens a change touches, for the review section: __SCREENS__

## Spec labels

Specs are GitHub issues moving through `spec:draft` → `spec:ready` → `spec:building` → `spec:in-review`, or
`spec:stuck`, and close when their PR ships.
