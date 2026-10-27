# Note — Altair group meetups slice

> Draft. Sections marked *(to fill)* are completed as the build progresses.

## Product decision: approximate area until RSVP

Members who haven't RSVP'd see an **approximate area**. Members who have RSVP'd, and the creator, see the **exact point and place name**.

**Why, grounded in the people using the app.** Walking groups meet on a routine: same park, same weekday, same hour. An exact pin shown to every member tells all of them where specific neighbours (and their dogs) will be, and when. Most of those members aren't coming. The people who do plan to attend need the exact spot; everyone else only needs to answer "is this near enough for me?". RSVP is the moment someone says "I'm coming", so that is when the exact spot is revealed.

**How the area is computed (in the database, at create time):**
- The map is divided into a fixed grid of roughly 800 m × 800 m cells. The approximate area is a 600 m circle around the center of the cell containing the meeting point. 600 m exceeds the cell's half-diagonal (~566 m), so the real point is always inside the circle. 600 m is also comfortably above the 300 m minimum.
- If the meeting point happens to sit almost on the cell center, the circle is shifted by half a cell, so its center is never the exact point.
- The place name is withheld until RSVP and replaced by a coarse label.
- The area is stored with the meetup, not recomputed per request.

**Why a grid and not a random offset.** My first design gave each meetup its own random offset. That breaks for recurring meetups: four Saturday walks from the same gate produce four differently shifted circles, and overlaying them shrinks the overlap to the gate itself, so the noise cancels out. A grid is deterministic. Every meetup at the same place gets the identical circle, so collecting more meetups reveals nothing new.

**Enforcement.** The exact point and place name live in a separate table, `meetup_locations`. Its row-level security returns a row only to a current group member who is the creator or has an RSVP. A member without an RSVP gets no row at all: the data never leaves the database, and nothing is hidden in the app. After RSVP, the app refetches and the row becomes visible. Withdrawing, or leaving the group, removes access again.

### Known limit: sparse areas, and the proper fix (k-anonymity)

A fixed grid is the same size everywhere. In a dense city, an 800 m cell contains dozens of parks, plazas and library steps, so the circle says little. In a small town, the same cell may contain only one public place, and then "approximate" effectively names the spot. Approximation reduces precision; on its own it can't stop someone from inferring the spot when there are only a few candidates.

**k-anonymity** is the standard way to make that guarantee explicit: *an answer is safe if it can't be narrowed below k equally plausible candidates.* Here the candidates are the public places a group could meet at. Instead of "the circle is 600 m", the rule becomes "the circle always contains at least k public places" (for example k = 5), whatever the town looks like.

How it would work:
1. **A places dataset**: parks, playgrounds, libraries, plazas, trailheads, e.g. imported from OpenStreetMap into a `public_places` table.
2. **A hierarchical grid**: cell sizes 400 m → 800 m → 1.6 km → 3.2 km. Each size nests inside the next.
3. For a new meetup, pick the **smallest cell level whose cell around the meeting point contains at least k public places**. The circle covers that cell.
4. The result is still deterministic per place, so the overlap attack above stays closed. Cells are large where places are scarce and small where they are plentiful.

Example: North gate, Linden Park, in a town with only two parks nearby. At 800 m the cell holds 2 places, fewer than k = 5. At 1.6 km it holds 4, still fewer. At 3.2 km it holds 6, so that becomes the area. The same rule in a dense downtown might settle at 400 m.

**Without an external dataset**, a fail-safe approximation is to count the distinct meeting points already used, across all groups, in each cell. Default to the largest level, and allow a smaller level only once it holds at least k distinct real meeting spots. A new or sparse town starts with the big area (safe by default), and precision improves only as genuine public spots accumulate.

**Why it isn't in this slice.** It needs either a curated places dataset or enough meeting history to be meaningful, and both are outside the provided files. The slice ships the fixed grid, with the cell size as a single constant, and documents k-anonymity as the next step.

### Other limits of this approach

- **RSVP is not a trust signal.** Any member can RSVP, read the exact spot and withdraw. The approximate area stops casual exposure, not a determined group member. The real boundary is group membership.
- **Free-text titles can leak the spot** ("Loop from North gate"). The create screen warns against it, but the rule protects coordinates and place names, not the creator's own words.
- Members learning each other's routines is accepted as normal for a group walk. Outsiders see none of it.

## Architecture choices

*(to fill: write model C, Edge Functions with Hono, reads under RLS, alternatives considered)*

## What I directed, what I reviewed or fixed by hand

*(to fill during the build)*

## One thing I'd refuse to build first

*(to fill)*

## Spec pushback

*(to fill: see docs/PLAN.md §14 for candidates)*
