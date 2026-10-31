# Submission checklist — Novi Sad Freestyle (Corey's clicks only)

Status: build verified locally. NOTHING below has been published,
submitted, or booked. Every step in this file is Corey's own click.

Deadline: submissions close **Sat Oct 31, 2026, 20:00 CET = 15:00 ET**.
CONFIRMED 2026-10-31: the Oct 30 "We're live" email corrects the Oct 29
agenda's 18:00 CET — "Not 18:00, as yesterday's email said: you have until
the end of the hackathon." The dashboard still governs; re-check there. Winners announced Nov 7. Prizes: $500 / $300 / $200 + 5×
six-month Mozaik Cloud Premium.

## 1. Dashboard check (do first, tonight)

- [ ] Open the hackathon dashboard: https://build.jigjoy.ai/dashboard
      (recovered 2026-10-31 from the Oct 29 agenda email HTML; same link
      in the Oct 30 "We're live" email).
- [ ] Confirm: starter template / primer — is one provided, and does
      this entry need to start from it? (Record the answer here.)
- [ ] Confirm: the EINSTEIN / Software Factory tracks are NOT this
      entry (Freestyle was picked). Confirm Freestyle submission fields.
- [ ] Confirm the exact submission close time shown on the dashboard.

## 2. Project fields (Corey fills in)

- [ ] Project title: HonorAnchor (decided by Corey 2026-10-31; replaces
      working title "Accountable Crew on Mozaik").
- [ ] Project description: use README.md's thesis + boundaries
      verbatim; do not add live-rail, CuNi-equivalence, or payment
      claims. The honest lines: simulated cents, scripted inference,
      TS receipt-trail reimplementation (not verified CuNi).
- [ ] Repo name / visibility: HonorAnchor, PUBLIC, ceedot-rock/HonorAnchor
      (decided 2026-10-31; repo does NOT exist yet — no git repo was created
      for this build. Push this directory once demo.html lands; confirm
      `node_modules/` and `runs/` are excluded. `vendor/` DROPPED from the
      submission per Corey's /drop 2026-10-31 — excluded via .gitignore,
      local copy retained; the build does not import from it.)
- [ ] Team: solo (registration already submitted-confirmed 2026-10-26).
- [ ] Demo video / screenshots: __________ (none produced by the
      builder. If a video is required, record `npm run demo` — it is
      deterministic and needs no keys.)

## 3. Demo slot (optional)

- [ ] Demos Sat 17:00–20:00 CET, booked on the dashboard. Decision:
      BOOK (Corey /book 2026-10-31). Slot time picked on the dashboard
      at submit time (his pick).
- [ ] If yes: slot time (CET + ET): __________

## 4. Before submitting (verify fresh)

- [ ] Run from a clean checkout/clone: `npm install && npm test`
      (expect 18/18) and `npm run demo` (expect exit 0, 17/17
      receipts verified). Record the new run id here: run-2026-10-31T103002Z
      (fresh run 2026-10-31 ~06:30 ET: 18/18 tests, 17/17 receipts).
- [ ] Confirm the submitted code is the code that was just run
      (no uncommitted edits after the verification run).

## 5. Submit

- [ ] Submit on the dashboard. Submission is Corey's click only.
- [ ] Save the submission confirmation / reference here: __________

## Open questions for Corey (from the build)

1. Project title — confirm or replace the working title?
2. Repo: public GitHub repo with README (organizer rule, Oct 30 email;
   resubmits allowed, last entry counts). DECIDED 2026-10-31: name HonorAnchor,
   public, ceedot-rock/HonorAnchor; vendor/ dropped from the submission.
3. Demo slot — DECIDED 2026-10-31: BOOK. Slot time picked on the dashboard.
4. Demo video: NO video requirement stated in the organizer emails (Oct 29/30);
   demos are live + optional. If the dashboard form asks for one, check then —
   demo.html can be screen-recorded.
