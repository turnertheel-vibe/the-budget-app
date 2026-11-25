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

## Status

Early stage. All screens are implemented and wired to Supabase (schema v3);
TypeScript is clean and the web build renders. Google sign-in needs the
Google Cloud OAuth client and the Supabase Google provider configured
before it works end to end. No native build yet.

## Development

```bash
npm install
npm run start   # or npm run web
npx tsc --noEmit
```

Configuration lives in `.env` (copy `.env.example` to `.env`):

- `EXPO_PUBLIC_SUPABASE_URL` — the Supabase project URL.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — the Supabase publishable (anon) key.

Secrets live in `.env` locally and in EAS secrets for builds — never in the
repo. Never put the Supabase service role key anywhere in this project.
Google sign-in also needs the Google Cloud OAuth client and the Supabase
Google provider configured before it works end to end.
