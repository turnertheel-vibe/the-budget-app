# The Budget App

A mobile-first budgeting app you can control with AI — built to replace a
spreadsheet, with customizable labels and receipt-level detail.

## What it does

- Monthly budgets with a dashboard: amount remaining, and a Wants / Needs /
  Savings split.
- A transaction log with full detail — item, merchant, date, amount, label,
  category, account, and receipt.
- Labels you can add or remove freely.
- Receipt splitting, with sales tax allocated per item.
- AI control: an assistant can read and modify all of the app's data through
  a defined API, with every change logged.

## Stack

- **App:** React Native + Expo, TypeScript.
- **Backend:** Supabase (hosted Postgres) — database, auth, and receipt
  storage.
- **License:** MIT.

## Docs

- [docs/budget-app-logic-write-up.md](docs/budget-app-logic-write-up.md) —
  the full specification of the spreadsheet logic this app preserves.
- [docs/budget-app-vision-requirements.md](docs/budget-app-vision-requirements.md) —
  vision, requirements, and open questions.

## Status

Early stage. The spec docs are done; the app itself is not built yet.
