# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Renamed public commands from `/advice` and `/advice-every` to `/advise` and
  `/advise-every`.
- Reframed reconsideration as the assistant's own fresh realization and hidden
  continuation from that realization.
- Replaced visible control prompts with hidden custom messages and added the
  `Advising...` / `Advising: <focus>` start notification.
- Shows `Advising... 🧠 ` as Pi's working message while reconsideration is
  actively streaming, including authorized advisor tool investigation.
- Documented support for default `steeringMode: "one-at-a-time"` only.

### Fixed

- Deferred automatic cycles now saturate only after their configured interval.
- Activation rechecks pending steering before queueing reconsideration.
- Model-switch exceptions and restoration failures fail closed: no continuation
  is sent after unsuccessful restoration, and automatic advice is disabled.
- Tool-free cycles no longer remain in a tool loop after `toolUse`.
- Configuration validation now validates each source before merging and reports
  malformed files and invalid fields without throwing.
- Process-global schedule validation rejects malformed persisted state.

## [0.1.0] - 2026-07-19

### Added

- Initial model reconsideration cycle with configuration, periodic cadence,
  autocomplete, and reload-local scheduling.
