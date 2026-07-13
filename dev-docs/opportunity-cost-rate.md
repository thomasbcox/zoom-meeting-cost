# What "rate" means: hourly opportunity cost

**Canonical definition — the single source of truth for this concept.** Public docs,
in-app copy, and code comments all defer to this note.

> The **rate** you enter — an average across participants — is an **hourly opportunity
> cost**: the value of the highest and best work someone could be doing instead of being in
> this meeting. It is deliberately **not** their wage or salary, because:
>
> - **(A) Pay is private.** We never ask for it, never want it, and never store it.
> - **(B) Pay understates the meeting's cost.** An hour of someone's best work is
>   usually worth far more to the organization than what they are paid for that hour.

## Why this matters

The number this tool multiplies by people and time is an **estimate of value
forgone**, not an accounting of salaries. Salaries are largely fixed and sunk — you
pay them whether or not the meeting happens — so they are the wrong input for the
question this tool exists to provoke: *is this meeting worth more than what everyone
in it would otherwise be doing?* Opportunity cost is the right input, and it is almost
always higher than wage.

## How it maps to the code (name unchanged)

The identifier still says `rate` for historical reasons, and we are **not** renaming it.
Semantically it holds an **hourly opportunity-cost** figure:

- `simpleAverageRate` — the average opportunity cost per participant in the simple model
  (cost = attendee count × this rate). This is the app's only rate field.

(The old per-person model — `rateTable`, `defaultRate`, `overrides`, name matching — and the
legacy `multiplier` field were removed in the dead-simple pivot; there is no per-person schema
anymore.)

## What never leaves the design

- Participants never see individual figures — the camera overlay carries **aggregate
  numbers only** (`buildOverlayState`).
- The presenter's config (the attendee count + one rate) is **session-only** — held in the
  browser for the meeting and never saved on our servers. See the Privacy Policy in
  `docs/privacy.html`.
