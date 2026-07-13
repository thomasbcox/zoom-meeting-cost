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

## How it maps to the code (names unchanged)

The identifiers still say `rate` for historical reasons, and we are **not** renaming
them. Semantically, every one of these holds an **hourly opportunity-cost** figure:

- `rateTable: [{ id, name, rate }]` — per-person opportunity cost
- `defaultRate` — opportunity cost for anyone not in the table
- `simpleAverageRate` — average opportunity cost in the simple (N × rate) model
- `overrides[participantId]` — a per-meeting opportunity-cost override

The `multiplier` field — a legacy compensation concept (overhead on pay) that no longer fit
this framing — has been **removed** (see [`reviews/remove-cost-multiplier.md`](../reviews/remove-cost-multiplier.md)).
The current schema has no multiplier; `rateStore` tolerates but ignores a stray legacy value on
an old saved config.

## What never leaves the design

- Participants never see individual figures — the camera overlay carries **aggregate
  numbers only** (`buildOverlayState`).
- The presenter's config (names + opportunity-cost values) is stored **encrypted at
  rest**, keyed to their Zoom account, only to restore their own settings across
  sessions and devices. See the Privacy Policy in `docs/privacy.html`.
