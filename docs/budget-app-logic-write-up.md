**BUDGET APP  •  SPECIFICATION FROM THE CURRENT SPREADSHEETS**

# Budget App — Logic Write-Up

How the current monthly budget workbooks and Receipt Tracker work, written for someone building an app to replace them. Source spreadsheets and documents were read only — nothing in them was edited.

*For Turner  •  Based on November-26_The-Budget, December-26_The-Budget, and the Receipt Tracker Rules doc  •  November 2026*

## Purpose of this document

The goal is an app instead of a spreadsheet. That only works if the app preserves the logic already in the spreadsheet — the tab structure, the Chart of Accounts, and the Receipt Tracker Rules — rather than inventing a new budget system. This document records that logic in one place, in the order a builder will need it: workbook first, data entry second, rules third.

## What exists today

- Monthly budget workbooks: November-26_The-Budget and December-26_The-Budget, with identical layout. Budgets run from November 2026 onward; there is no October budget.

- A Receipt Tracker sheet and a Receipt Tracker Rules document that governs how receipts, statements, invoices, and Venmo activity become Data Entry rows.

- Receipt files stored in 2.1.1 Receipts Storage, plus receipt photos from stores such as Costco, Target, Walmart, Amazon, and Dick's.

- New project folders in Drive: 4.0 Code Project, with 4.1 Ideas inside it, created for this app work.

## Workbook structure: six tabs in every month

Each monthly workbook has the same six tabs. A builder should treat one workbook as one month instance of the same structure, not as six unrelated sheets.

| Tab | What it does |
| --- | --- |
| Dashboard | Month overview and category breakdowns (details below) |
| Data Entry | The transaction log for the month — every logged item is a row here |
| Chart of Accounts | The controlled list of Labels, their Category, and their Section |
| Income | Income summary for the month |
| Expenses | Expenses summary for the month |
| Savings & Debt | Savings and debt summary for the month |

### Dashboard

The Dashboard is the read-only summary view for the month. It contains:

- A month header and the amount remaining to budget.

- Projected percentages for Wants, Needs, and Savings. For November those projected figures are 8.1% Wants, 77.4% Needs, and 5.6% Savings.

- Income, Expenses, and Savings overviews, each with Projected / Actual / Difference.

- Category breakdowns using the categories listed below.

| Breakdown | Categories shown |
| --- | --- |
| Income | TNU, Mertzcrew, Other Income, Gifts, Reimbursement, Miscellaneous |
| Expenses | Food, Giving, Health, Housing, Insurance, Education, Lifestyle, Transportation, Debt, Other |
| Savings | Jenius Bank, Emergency Fund, Fidelity rIRA, Travel Fund, Car Fund, Gift Fund, Yearly Expenses Fund |

In the app, the Dashboard becomes the home screen for a month: remaining to budget at the top, the Wants / Needs / Savings percentages, the three Projected / Actual / Difference overviews, and the category breakdowns underneath. It is calculated from Data Entry and the projected figures, not entered directly.

### Data Entry: the transaction log

Data Entry has nine columns, in this order:

| Col | Column | Notes |
| --- | --- | --- |
| A | Item Description | What was bought / what the entry is |
| B | Merchant | Where / from whom |
| C | Date | Transaction date |
| D | Amount | Always positive — see Amount rule below |
| E | Label | From Chart of Accounts |
| F | Category | Derived from the Label via Chart of Accounts |
| G | Account Type | As listed in Data Entry |
| H | Account | Which account — see Accounts in Rules |
| I | Filename | Receipt / invoice filename, or blank for bank imports — see Filename rule |

**Volume: **November has 74 entries in Data Entry.

**Amount rule: **All amounts are positive. When a statement shows a debit as a negative or as a debit amount, it is flipped to positive when it is logged in Data Entry. The app should store amounts as positive values and let Label / Category / Section carry whether it is income, an expense, or savings — exactly as the sheet does.

### Chart of Accounts: Label, Category, Section

The Chart of Accounts has three columns — Label | Category | Section — where Section is one of: Expense, Income, Savings, or Rewards. The Label is what is chosen on a Data Entry row; the Category and Section follow from it. The app must use this as a controlled vocabulary: no free-text labels.

Expense labels, grouped by Category as listed in the workbook:

| Category | Labels (Expense) |
| --- | --- |
| Business | Virtue Production, Contract Work, Theel Home Studios |
| Debt | MOHELA 1 |
| Food | Eating Out, Snacks, Groceries |
| Giving | Gifts, Charity, Tithe |
| Health | Doctor Visits, Medicine/Vitamins, Therapy |
| Housing | Electricity, Water, Trash, Natural Gas, Home Projects, Restock Items, Rent, AT&T |
| Insurance | Auto, Health, Renters |
| Taxes | Taxes (label as listed) |
| Education | School |
| Lifestyle | Alcohol, Birthday, Clothing, Coffee Beans, Coffee Shop, Hygiene, Home Decor, Kitchen Items, Phone, Travel, Date Night, Fitness, Netflix, Peacock, Prime, Costco Membership, Tech Products, Tools, Apple, Turner - Fun, Emily - Fun, Shipping Fee |
| Transportation | Ride Share, Car Fees, Car Payment, Gas, Maintenance, Parking, Plane Tickets, Rental Car |

Note on the Taxes row: the source list gives “Taxes” under Chart of Accounts categories/labels without a separate distinct label list in the material provided for this write-up, so it is recorded as listed rather than expanded.

Income, Savings, and Rewards labels:

| Section | Labels |
| --- | --- |
| Income | TNU Paycheck 15, TNU Paycheck 30, Miscellaneous, Mertzcrew, Other Income, Cash Gifts Received, Cash Reimbursement |
| Rewards | Credit Card Rewards |
| Savings | Yearly Expenses Fund, Car Fund, Emergency Fund, Income Tax Savings, Jenius Bank, Gift Fund, House DP, Fidelity rIRA, Travel Fund |

### Income, Expenses, and Savings & Debt tabs

Each of these three tabs carries a Summary of Projected / Actual / Difference across Income, Expenses, and Savings. In other words, the summary structure repeats: projected is what was planned, actual is what Data Entry adds up to, and difference is actual compared with projected. In the app these are not separate data stores — they are three views calculated from the same Data Entry rows and the same projected figures, grouped by Section and Category.

## Receipt Tracker Rules

The rules below are from the Receipt Tracker Rules doc, as read for this write-up. They govern how source material — receipts, bank and card statements, invoices, and Venmo activity — becomes Data Entry rows. An app has to enforce, or at least prompt for, each of them.

### Splitting receipts and allocating tax

- A receipt with multiple items is split by Label, not logged as one lump sum. Example given in the rules: paper towels = Restock Items, strawberries = Groceries, on the same receipt.

- Like items are grouped into one entry, rather than one row per individual item.

- Sales tax is included in each item's price. Tax is allocated per item at that item's tax rate — groceries are often taxed at a lower rate — so split entries include their share of tax.

- Grocery trips are split further where the rules require it: wine/beer, restock items, and medicine go to their own Labels, with tax allocated accordingly.

- Bulk drinks and chips bought alongside groceries stay under Groceries. Standalone snack or convenience stops are Snacks.

### Accounts

| Account as logged | What it is / when it is used |
| --- | --- |
| Wells Fargo *1548 | Physical card — main credit card |
| Wells Fargo *6115 | Apple Pay number for the same Wells Fargo card as *1548 |
| Citi *3007 | Costco card: gas, Costco, restaurants, travel |
| US Bank *0094 | Debit, rarely used; all income flows through it, bills are paid from it, cash is deposited via ATM |
| Emily's Discover | Emily's clothes and gifts |

The app needs to treat *1548 and *6115 as the same underlying card with two numbers, not as two separate accounts, while still recording which number was used on the row.

### What to log — and what never to log

- Budgets run November 2026 onward. There is no October budget, so October-dated statement rows are skipped.

- Never log credit card payments. Logging them double-counts spending that was already logged when the purchase was made.

- Grocery store charges with no matching receipt in the log should be asked about rather than logged blind.

### Filename in column I

- Bank-import rows leave Filename (column I) blank.

- Receipt and invoice rows always carry their filename in column I, as a clickable HYPERLINK.

In the app this becomes a simple rule: a transaction created from a receipt or invoice must have an attached file; a transaction created from a bank import must not require one.

### Venmo

- Venmo is logged at the transaction level from activity that Turner sends, not from bank statements.

- Incoming Venmo defaults to Cash Reimbursement.

### Invoice income

- Invoice income logs only the earned amount: services minus cash per diem already paid, which equals the direct-deposited amount.

- That amount is pulled from the actual invoice PDFs, never from the income tracker.

### Cash deposits

- Cash deposits are logged as income when they hit the bank — for example tour per diem cash — as their own rows.

### Reimbursements

Reimbursements are not income, and they stay categorically separate. The handling has three distinct parts that are easy to conflate, so the app must keep them apart:

- Each reimbursement gets its own Data Entry row directly beneath the payment it came with, labeled Cash Reimbursement, with receipts itemized in the description and the same invoice filename in column I.

- Receipts attached to outbound invoices — rental cars, gas, Uber/Lyft — are reimbursement documentation filed with the invoice. They are never logged as spending.

- Reimbursed purchases do log as expenses on the card that paid for them, with the reimbursement logged separately as Cash Reimbursement income, so both sides offset.

### Savings transfers and virtual funds

- Transfers to savings account 2432 log as Emergency Fund for now.

- Percentage-based virtual funds — Car Fund, Phone, and similar — are a future project, held on one real account. They are not separate bank accounts in the current logic.

### Paychecks

- Emily's Trevecca paychecks are $1,440.58 on the 15th and on the 30th, labeled TNU Paycheck 15 and TNU Paycheck 30 respectively, with Account: US Bank.

### Statement descriptor map

Bank and card statement descriptions do not always match the real payer or merchant. The rules map these descriptors as follows:

| Statement descriptor | Means |
| --- | --- |
| BurdistheWord | Ethan Burdick |
| ROADSIDE ASSISTA | Restless Road's tour LLC |
| David C Cook | Integrity Music |
| McKay Production | House Right |

The app should apply this map automatically when importing statement rows, and allow new mappings to be added without changing past rows' meaning.

### Receipt filing

- Receipt files are uploaded to 2.1.1 Receipts Storage with the naming pattern YYYY-MM-DD_Vendor-description.

- A row is also added in the Receipt Tracker sheet with date, filename, Drive link, and message ID when the receipt came by email.

## Data model for the app

Mapped directly from the tabs, columns, and rules above — nothing here adds a category or a rule that is not in the source material.

| App record | Maps to | Core fields |
| --- | --- | --- |
| Month / Workbook | One monthly workbook | Month, projected Wants/Needs/Savings %, amount remaining (calculated) |
| Transaction | One Data Entry row | Item Description, Merchant, Date, Amount (positive), Label, Category, Account Type, Account, Filename |
| Chart Entry | One Chart of Accounts row | Label, Category, Section (Expense / Income / Savings / Rewards) |
| Account | Accounts rule list | Name / last digits, type, notes (e.g. *1548 and *6115 = same card) |
| Receipt File | Receipts Storage + Tracker row | Filename (YYYY-MM-DD_Vendor-description), Drive link, date, message ID if by email |
| Descriptor Mapping | Statement descriptor map | Statement text, resolved name |

Calculations the app must reproduce: Projected / Actual / Difference summaries on the Dashboard and on the Income, Expenses, and Savings & Debt views; Actual totals grouped by Category and by Section from Data Entry; and amount remaining to budget for the month.

## Questions for Turner

These questions were asked when the project was set up, and their answers shape scope. They do not change the logic above, which should be preserved either way in a first version.

- **Users: **Who is using it — just you, or you and Emily together?

- **Pain point: **What is the main pain with the spreadsheet right now — what does the app have to do better?

- **Platform: **Phone-first, or on your computer too?

- **Categories: **Keep the exact same categories and rules as above, or use the app as a chance to rethink them?

*— End of write-up. Sources: November-26_The-Budget and December-26_The-Budget (6 tabs each, identical layout) and the Receipt Tracker Rules doc. No source file was edited for this document.*
