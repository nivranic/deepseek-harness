# Agent Note: Localized Settings names in the collapsed sidebar

Status: implemented

English | [中文](2026-09-06-settings-rail-accessible-name.zh.md)

## Problem

The Settings button derives its accessible name from its registered content. Removing the label in a collapsed sidebar leaves an unnamed icon button, so assistive technology and name-based interaction cannot identify it. Narrow viewports can select this state automatically.

## Decision

The [settings trigger](../../../../packages/client/ui-settings-general/README.md) keeps its locale-owned text in both sidebar widths. The collapsed presentation visually clips that text without removing it from the accessibility tree or changing the icon button's dimensions. The shell continues to derive the name from its slot content.

## Alternatives considered

- Removing or applying `display: none` to the label also removes the name from content-based accessibility.
- Adding a separate translated label to the shell duplicates copy ownership across the shell and its content registrant.

## Consequences

The English and Chinese collapsed controls remain identifiable and open the same Settings panel. Component checks and an owner-local browser ARIA snapshot cover both locales. Browser comparison checks that the expanded and collapsed button dimensions remain unchanged. Packaged desktop acceptance still runs through the Windows candidate producer.
