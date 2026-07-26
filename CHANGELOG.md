# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-19

### Added

- `/advice` and `/advice --tools` for a manual advisor review that restores the
  advisee and promotes continuation.
- `/advice-every <N>`, `/advice-every <N> --tools`, and `/advice-every off` for a
  periodic low-level-turn cadence.
- Global and trusted-project configuration merge with a `thinkingLevel` default
  of `high`.
- Process-local `/advice-every` schedule surviving idle `/reload` only.
- Contextual autocomplete for `--tools` and `off`.
- Manual `/advice` is rejected while steering messages are pending, and an
  automatic threshold defers until the queue is empty, so an advisor never
  runs under the wrong model (PLAN.md Amendment 1). The advisor is activated
  before its prompt is queued; restoration happens before the continuation
  turn's model snapshot.
