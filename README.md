# The Budget App

A mobile-first budgeting app you can control with AI — built to replace a
spreadsheet, with customizable labels and receipt-level detail.

## The idea

The monthly budget spreadsheet works. The experience around it doesn't. This
app keeps the spreadsheet's logic — monthly budgets, a dashboard with the
amount remaining and a Wants / Needs / Savings split, a transaction log, and a
chart of accounts — and fixes everything else: the interface, sharing with
family and friends, and control by an AI assistant.

The bar is Dave Ramsey's EveryDollar, whose functions are too limited. This
app outdoes it on flexible labels, AI control, and receipt-level detail
(splitting one receipt across labels, with sales tax allocated per item).

## Who it's for

- Turner and Emily first — one shared household budget.
- Then family and friends, each household with their own separate, private
  budget data.
- Eventually, App Store users.

## Requirements

- **Mobile-first.** Designed for the phone. App Store release eventually.
- **Great UI/UX.** The spreadsheet logic is the foundation; the experience
  is the product.
- **Customizable labels.** Users can add or remove labels as they please —
  unlike the fixed chart of accounts in a spreadsheet.
- **AI-controllable.** An AI assistant (like Muse) can read and modify all
  of the app's data — entries, labels, categories, accounts — through a
  defined API, with every AI change logged and undoable.
- **Open source.** MIT licensed. The code is public; each household's budget
  data stays private in their own backend.

## Planned stack

- **App:** React Native + Expo, TypeScript — one codebase for iOS and
  Android, real path to the App Store.
- **Backend:** Supabase (hosted Postgres) — database, auth, and file storage
  for receipt photos. Free tier covers the start; costs scale only with use.
- **AI control:** a locked-down API layer on top of Supabase exposing a
  defined set of actions (add entry, edit entry, add/remove label, …),
  so an AI can act on the user's behalf without ever holding a database
  password.

## Docs

- [docs/budget-app-logic-write-up.md](docs/budget-app-logic-write-up.md) —
  the full specification of the current spreadsheets: workbook structure,
  Data Entry columns, the Chart of Accounts, and the Receipt Tracker Rules.
- [docs/budget-app-vision-requirements.md](docs/budget-app-vision-requirements.md) —
  vision, who it's for, what stays from the spreadsheet, what changes, and
  open questions.

## Status

Early stage. The spec docs above are done; the app itself is not built yet.
Next step: a first mobile prototype of the core flow — dashboard, adding an
expense, managing labels — on the real categories.

## License

MIT. See [LICENSE](LICENSE).
