# Audit — Oracle Simphony time card format (saved reference)

Captured 2026-06-14 for the future **punch-in / punch-out review** (the Audit feature:
scheduled vs. actual). This is the actual-punch source we compare the schedule against.

## Where it comes from
Oracle MICROS Simphony → Reporting & Analytics → **"Time Cards by Employee and Job Code"**
report (the same R&A we linked from the Weekly schedule). Enterprise: Dunkin Brands (DUN).
Likely exportable (CSV/Excel) and/or via OHIP / R&A API once Oracle provisions access.

## Columns (one row per punch / shift)
- **Name** — shown as the crew label, e.g. `Crew, 1`, `Crew, 11 - DD`, `Crew, 12 - Rab`
  (crew number, sometimes with a short suffix — NOT the person's full name).
- **Payroll ID** — Oracle external payroll id, e.g. `6000198393`, `6000408035`, `6000408025`.
  This matches the **External Payroll ID** on the Oracle People page (Tamer = 6000163597).
- **Clock in Date and Time** — e.g. `06/07/2026 8:02:24 AM`.
- **Clock Out Date and Time** — e.g. `06/07/2026 2:19:48 PM`.
- **Clock Out Status** — e.g. `Undefined`.
- **Adjustment Count** — number of manual adjustments on that punch.
- **Regular Hours** — duration in `HH:MM:SS`, e.g. `09:13:48`, `17:58:48`, `04:35:24`.
- (cut off in the sample) **Regular Pay / overtime / etc.** to the right.

Top-of-report totals: **Hours Total** `361:08:60` and **Total Pay** `5,656.24`.

## Format notes / gotchas to handle when we build it
- Times/durations are **HH:MM:SS**. The totals show odd seconds like `:60` / `:48` —
  Oracle appears to render fractional time strangely (e.g. `08:60`), so parse defensively
  and recompute durations from clock-in/out rather than trusting the displayed duration.
- Rows are grouped by employee (a header row per `Crew, N` with the Payroll ID, then the
  daily punch rows underneath, each tagged with a job code like `DD CREW PLUS`).
- Some shifts cross into the evening (e.g. clock out `11:00:00 PM`).

## Mapping actual punches → our roster (the key design question)
Two candidate keys, in order of reliability:
1. **Payroll ID (6000…)** — most reliable. We'd store each roster employee's Oracle
   payroll id (new field, e.g. `employees.oracle_payroll_id`) and join on it.
2. **Crew number** — our roster already has crew numbers (Crew 0, Crew 9, …). The report's
   `Crew, N` could map to that, but it's looser (suffixes like `- DD`, `- Rab`).

Note: our POS pins are `362538…` (store 362538 = Home Store `DDBR362538`); Oracle payroll
ids are the separate `6000…` series. Don't confuse the two.

## What the Audit will do with this (per the agreed rules)
For each employee/day, compare **scheduled** in/out vs **actual** punch in/out, then apply:
- clock-in early  → adjusted in = scheduled in (don't pay early).
- clock-in late   → adjusted in = actual.
- clock-out late within the employee's buffer (employees.buffer_min) → waive, keep scheduled out.
- clock-out late beyond buffer → **cap at scheduled out** and **highlight** (manager can approve OT).
- clock-out early → adjusted out = actual.
- buffer_min = 0 means exact (use actual times).
Show a scheduled / actual / adjusted grid with color highlights where they differ.

## Intake options (build order TBD with user)
- Screenshot/upload of this report → AI reads the rows into `time_punches` (table already
  exists: employee_id, work_date, in_time, out_time, unique(employee_id, work_date)).
- CSV/Excel export upload (cleaner than screenshot if R&A can export).
- OHIP / R&A API pull (best; needs Oracle to provision credentials).
</content>
