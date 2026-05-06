# Product milestones (implementation roadmap)

This folder contains **agent- and human-readable** product milestone specs (M01–M10). Normative game rules, protocol, and UI FSM remain in [`../README.md`](../README.md); milestones **reference** those docs instead of duplicating them.

## How to use (especially for agents)

1. Load **[`MILESTONES.md`](MILESTONES.md)** for the full ordered specification (M01–M10 in one file).
2. When implementing a milestone, cross-check **Related codebase** and **Related existing docs** sections inside that milestone only.
3. Use **Acceptance criteria** as a completion checklist; use **MUST / SHOULD / MAY** statements as binding requirements within each milestone.

## Milestone index

| ID | Title |
|----|--------|
| **M01** | Login: Cloudflare CAPTCHA and non-invasive bot protection |
| **M02** | Visual move feedback: last-move tile highlight + opponent-move animations |
| **M03** | Auditory feedback: UI sounds for moves, draws, game end |
| **M04** | History page: account-only persistence, replay with animation and sound timing |
| **M05** | Setup library, lobby setup rules, hash load, flip mechanic, library search |
| **M06** | Local game: alternating colors, lobby UI without multiplayer |
| **M07** | Analysis board: brush tool for arbitrary positions |
| **M08** | Cross-page navigation and preserved back-navigation state |
| **M09** | Interactive tutorial: chapters 1–7 plus extra chapters |
| **M10** | Discord Activity + Discord sign-in for accounts |

## Conventions

- **Stable IDs**: `M01` … `M10` always refer to the same milestones as in this table.
- **Order**: Implementation priority is not fixed by this doc; milestone **order** matches the canonical M01–M10 numbering in [`MILESTONES.md`](MILESTONES.md).
- **Dependencies**: Listed per milestone in `MILESTONES.md` where cross-milestone work matters.
