**4.0  CODE  PROJECT  •  4.1  IDEAS**

**Budget App —
Vision & Requirements**

*Keep the spreadsheet logic. Fix the experience. Build it mobile-first, make it controllable by AI, and let every user shape it to their own life.*

| For | Turner and Emily first — then family and friends, each with their own budget |
| --- | --- |
| Platform | Mobile-first (mobile view). Good enough for the App Store, eventually |
| Companion doc | Budget App — Logic Write-Up, in the same folder (4.1 Ideas) — the full spreadsheet logic this vision preserves |
| Replaces | The monthly budget spreadsheets: November-26_The-Budget and December-26_The-Budget |

| The idea in one line:  The spreadsheet works how Turner likes it. The problem is not the logic — it is the user experience and the interface. This document is about solving that problem without losing what already works. |
| --- |

# 1  —  Keep the logic, fix the experience

Turner already has a budgeting system that works. Month after month, the budget spreadsheets capture income, expenses, savings and debt, sort every transaction by label and category, and show at a glance what is left and where the money went. The logic behind that system is documented in full in the companion document, Budget App — Logic Write-Up.

What the spreadsheet cannot do is feel good to use. Entering a receipt, splitting it across labels, checking what is left in a category, or reviewing the month means opening a workbook, finding the right tab, and working in rows and columns. On a phone, that experience breaks down.

The vision is a real app that does exactly what the spreadsheet does — with a great user interface (UI) and user experience (UX) on top of it. Same monthly rhythm, same categories, same rules for receipts, reimbursements, and income. New experience: fast to open, easy to read at a glance, and simple enough to use in the moment, not just at a desk at the end of the month.

- **At a glance: **Open the app and immediately see where the month stands.

- **In the moment: **Add an expense or a receipt in seconds, from a phone.

- **Underneath: **Trust that the numbers underneath follow the same rules as the spreadsheet.

# 2  —  Turner and Emily first, then everyone they share it with

The first users are Turner and Emily. The app has to work for a household budgeting together — both people adding entries, both people seeing the same month, the same dashboard, and the same picture of what is left.

It does not stop there. Turner wants to share the app with family and friends for them to use too. That changes the design from the start: this is not a personal file with two editors. It is a product that other households can pick up and use with their own money, their own accounts, and their own labels.

| Audience | What they need |
| --- | --- |
| Turner & Emily | One shared household budget, both able to add and review entries |
| Family & friends | Their own separate budget data — private to their household |
| Future App Store users | An app polished enough to download, set up, and trust without Turner in the room |

Each person or household gets their own budget data. Sharing the app means sharing the tool, not sharing anyone's numbers.

# 3  —  What stays from the spreadsheet: the logic does not change

Everything in this section carries over from the spreadsheets and the Receipt Tracker Rules. The app is a new front end for this logic, not a new system. The full detail lives in the Logic Write-Up; this is the checklist the app must preserve.

## Monthly budgets and the Dashboard

Budgets run by month, as the November and December workbooks do. The Dashboard remains the home view: how much is left to budget, and the split between Wants, Needs, and Savings. In the app, that Dashboard becomes the first screen — the same information, readable in seconds on a phone.

## Data Entry — every transaction, fully described

Every entry keeps the nine fields from the Data Entry tab. Nothing is dropped to make the app simpler; the app makes these fields easier to fill in.

| Field | What it captures |
| --- | --- |
| Item Description | What was bought |
| Merchant | Where it was bought |
| Date | When it happened |
| Amount | How much |
| Label | The specific label for the item |
| Category | The category the label rolls up to |
| Account Type | The type of account used |
| Account | The specific account |
| Filename | The linked receipt filename |

## Chart of Accounts and Receipt Tracker Rules

The Chart of Accounts structure — Label | Category | Section — remains the way labels organise into categories and sections. The Receipt Tracker Rules remain the rules of the system:

- receipts split by label, with tax allocated per item;

- the accounts in the system and what each one is for;

- how bank imports, invoice income, reimbursements, and Venmo are handled.

If the app and the spreadsheet would treat the same receipt differently, the app is wrong. That is the test.

# 4  —  What changes: a mobile app, not a spreadsheet on a phone

| Area | From spreadsheet to app |
| --- | --- |
| Experience | Rows and tabs become screens designed for the task — add, review, check what is left |
| Mobile | Desktop workbook becomes mobile-first, designed for a phone screen first |
| Sharing | One household's file becomes a product many households can use separately |
| Labels | Fixed Chart of Accounts becomes labels users can add and remove freely |
| AI control | Manual editing only becomes full control by an AI assistant as well as by hand |
| Distribution | A file in Drive becomes, eventually, an app on the App Store |

## Great UI and UX is the point

Turner is explicit on this: the app needs to have great UI and UX. That is not polish added at the end — it is the reason the app exists. The spreadsheet already proves the logic; the app has to prove that the same logic can be quick, clear, and even enjoyable to use every day, for Turner and Emily and for people who have never seen the spreadsheet.

## Mobile-first

The app should be designed for mobile view first. Budgeting happens where spending happens — in a store, in the car, at the kitchen table — not only at a computer. The core flows (checking the Dashboard, adding an entry, reviewing a receipt) must work fully on a phone. Anything that only works on a wide screen is not finished.

# 5  —  Users own their labels

In the spreadsheet, the Chart of Accounts is fixed. Changing it means editing the workbook's structure, and every user of the system inherits the same list.

In the app, labels are fully user-customizable. Users can add or remove labels as they please:

- add a label when life changes — a new expense, a new project, a new priority;

- remove a label that no longer fits, without breaking the structure around it;

- keep the Label | Category | Section organisation, so a new label still rolls up cleanly into the Dashboard and the Wants / Needs / Savings view.

This matters for sharing, too. Family and friends do not live Turner's and Emily's life, so they cannot live with only Turner's and Emily's labels. Customizable labels are what make one app work for many households.

# 6  —  Built to be controlled by an AI

| Requirement:  An AI assistant like Muse must be able to control the app and modify all of its data. That is a core requirement, not a future extra. |
| --- |

Most budget apps are built only for fingers on a screen. This one is built for two kinds of users from the start: people, through the mobile interface, and an AI assistant, through a data layer underneath it.

That means the app needs an AI-accessible data layer — an application programming interface (API) or equivalent — that exposes the same things the screens expose, with the same rules:

- budget entries — add, edit, and remove entries with all nine Data Entry fields;

- labels and categories — add and remove labels, and organise them by category and section;

- accounts — work with the accounts and account types in the system;

- the monthly picture — read the Dashboard, including what is left and the Wants / Needs / Savings split, so the AI can answer questions as well as make changes.

The test is simple: anything Turner can do in the app, he should be able to ask the AI to do — and the AI should be able to do it completely, following the same Receipt Tracker Rules a person would follow. AI control is also what makes the app feel different in daily use: instead of opening the app and hunting for the right screen, Turner or Emily can simply ask for the change or the answer.

# 7  —  More flexible than EveryDollar

Turner's competitive goal is direct: take down Dave Ramsey's EveryDollar app, because its functions are so limited.

EveryDollar is the incumbent to outdo — a well-known budgeting app built around a fixed way of budgeting. Turner's view is that its functions are too limited for how he actually budgets. This app's answer is not to copy it with a fresh coat of paint. It is to beat it on the things his spreadsheet already does better, plus the things no spreadsheet can do:

| Where this app outdoes it | How |
| --- | --- |
| Flexible labels | Users add or remove labels as they please, instead of living inside a fixed structure |
| AI control | An AI assistant can read and modify all the data — not just a person tapping through screens |
| Receipt-level detail | Receipt splitting, tax allocated per item, and a filename linked to each entry |
| Proven logic | Monthly Dashboard, Wants / Needs / Savings split, and rules for reimbursements, Venmo, and invoice income |

The pitch, in short: the budgeting depth of Turner's spreadsheet, the ease of a great mobile app, and an AI that can run it with you — in a category where the best-known app still feels limited.

# 8  —  Open questions and next steps

## Open questions

- How do Turner and Emily share one household budget in practice — both signed in to the same household, with entries from either person treated the same way?

- When family and friends start, how does a new household get set up — start from Turner's labels as a template, or start blank and build their own?

- When a label is removed, what happens to past entries that used it — do they keep the old label in history, move to another label, or something else?

- What should the AI be able to do on its own, and what should it confirm first — for example, adding an entry versus deleting one, or changing labels and categories?

- What does App Store readiness require, and when — accounts, privacy, and data storage for multiple households all have to be answered before a public release.

## Next steps

Do not build everything at once. Build the core, prove it on a phone, then grow it.

- **1. Prototype the core flow. **Build a first mobile prototype of the core budgeting flow: Dashboard (what is left, Wants / Needs / Savings) → add an entry with the nine Data Entry fields → see it reflected in the month. Turner and Emily use it on their phones.

- **2. Prove the logic. **Test the prototype against the spreadsheet test: run the same receipts through both and confirm the app follows the Receipt Tracker Rules exactly.

- **3. Prove the labels. **Add customizable labels to the prototype — add and remove a label, and confirm the Dashboard still rolls up correctly.

- **4. Prove AI control. **Connect an AI assistant to the prototype's data layer and have it add an entry, change a label, and answer a Dashboard question.

- **5. Then share it. **Only after the core works for Turner and Emily, design the household-sharing flow for family and friends, and map the path to the App Store.

*Companion document: Budget App — Logic Write-Up (4.1 Ideas) — the full spreadsheet logic, workbook structure, Chart of Accounts, and Receipt Tracker Rules that this vision preserves.*
