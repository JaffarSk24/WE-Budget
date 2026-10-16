// Texts of the Features screen. Spread into en.js; the keys match help-ru.js.
export const helpEn = {
  'nav-help': 'Features',
  'help-subtitle': 'What WE Budget can do and how to use it',
  'help-intro': 'Everything the app can do, in one place. Click a row to read more; the button at the end of a description takes you to the right place.',
  'help-search-placeholder': 'Search, for example "envelope"',
  'help-filter-all': 'All',
  'help-filter-new': 'What is new',
  'help-found': 'Found: {n}',
  'help-none': 'Nothing found. Try another word.',
  'help-badge-new': 'new',
  'help-badge-desktop': 'on the computer',
  'help-badge-phone': 'on the phone',
  'help-open': 'Open: {screen}',
  'help-hint': 'New features are described in Features',
  'help-hint-close': 'Do not show again',
  'help-phone-row-hint': 'What the app can do and how to use it',
  'help-tab-today': 'Today',
  'help-tab-accounts': 'Accounts',
  'help-tab-more': 'More',

  'help-group-start': 'Getting started',
  'help-group-plan': 'The plan',
  'help-group-money': 'Money in and out',
  'help-group-accounts': 'Accounts and envelopes',
  'help-group-recurring': 'Recurring',
  'help-group-control': 'Planning and control',
  'help-group-analytics': 'Analytics',
  'help-group-goals': 'Goals and debts',
  'help-group-safety': 'Sync and safety',
  'help-group-phone': 'Phone and reminders',

  // Getting started
  'help-first-steps-title': 'First launch',
  'help-first-steps-short': 'Start from scratch, sign in with Google, open a file or look at the demo',
  'help-first-steps-body': `On first launch the app offers four ways in:

- Start from scratch: add your accounts and what they hold right now. Balances are counted from this day.
- Sign in with Google: if you already keep the budget on another computer, it comes down from the cloud.
- I already have a file: a WE Budget backup or the result of a spreadsheet import.
- Look around first: a made-up budget to try everything safely.

Delete the demo later in Settings, Data, with Delete everything. The app keeps a copy before deleting.`,

  'help-daily-routine-title': 'A typical routine',
  'help-daily-routine-short': 'Envelopes, recurring payments, splitting income, ticking off and checking',
  'help-daily-routine-body': `The budget works best this way:

1. Add envelopes to your accounts (Accounts and envelopes, the folder icon on an account), for example Bills or Groceries.
2. Add your recurring payments and incomes on the Recurring screen. The months ahead fill themselves.
3. When income arrives, mark it done. The app offers to split it: confirm, and the money for the coming payments is set aside.
4. Mark payments done as they go out: the circle on the row, or Space on the selected row.
5. Record small spending or unplanned income with Quick entry (Cmd+N on macOS, Ctrl+N on Windows).
6. Every now and then press Check against the bank on the Accounts screen and type in what the bank shows.

Tip: tick payments off every couple of days and the Free number always tells the truth.`,

  'help-language-theme-title': 'Language and theme',
  'help-language-theme-short': 'Thirteen languages, dark or light',
  'help-language-theme-body': `The app speaks thirteen languages: English, Russian, Slovak, Czech, Ukrainian, Spanish, French, Portuguese, Chinese, Hindi, Bengali, Arabic and Urdu. Arabic and Urdu are written right to left, and the whole interface mirrors for them. On the first start the app takes the language of the system when it has it, otherwise English. The theme is dark or light.

Switch them in Settings, Appearance: Language and Theme. On the phone the same is on the More tab.

The choice is kept with the budget and goes to your other devices with sync.`,

  // The plan
  'help-payment-calendar-title': 'Payment calendar',
  'help-payment-calendar-short': 'Each month as a list of payments and incomes with a status',
  'help-payment-calendar-body': `The Month screen lists every payment and income of the month by date. It shows what is planned, what has money set aside and what has already happened.

The arrows in the header move between months; the Item button adds a new one. Payments still waiting for money are highlighted. Done rows fold into one Done line; Show opens it.

At the top there is an account filter and Show cancelled. The cards above the list show the opening balance, income, expenses, money set aside and what is left at the end of the month.

Tip: double-click a row to edit it.`,

  'help-statuses-title': 'Statuses: planned, set aside, done, cancelled',
  'help-statuses-short': 'What each status means and how to change it',
  'help-statuses-body': `Every item has one of four statuses:

- Planned: in the plan, no money set aside yet. Such expenses are highlighted.
- Set aside: the money is already on the right envelope. It stays in the plan and no longer counts as free.
- Done: the money has actually gone out or come in.
- Cancelled: skipped this time; it does not count anywhere.

The circle at the start of a row marks it done, the piggy bank sets money aside. Cancel an item for this month in its dialog or by ticking several rows.

Marking a later-dated payment done moves it to today. Every change can be taken back with Undo in the message at the bottom.`,

  'help-balance-column-title': 'The balance column',
  'help-balance-column-short': 'What is left on the row\'s account after each payment',
  'help-balance-column-body': `On the Month screen the Account balance column shows the money on the row's own account after that row, so you see at once where an account would go below zero.

The total row at the bottom shows the month result over all accounts, as the Month end card does.

Tip: pick one account in the filter and the column reads like that account's statement.`,

  'help-bulk-actions-title': 'Bulk actions',
  'help-bulk-actions-short': 'Mark done, set aside, move or change the account of many rows at once',
  'help-bulk-actions-body': `Tick several rows on the Month screen and a bar appears at the bottom: Done, Set aside, Back to plan, Cancel, Date, Account, Split, Add tag and Remove tag.

The bar adds the ticked payments up per account, handy to check how much leaves each card.

Shift-click a checkbox to tick a range, X ticks a row, Cmd/Ctrl+A ticks every row of the month, Esc clears the ticks. Date sets one date or shifts all by a few days. Every action can be undone from the message at the bottom.`,

  'help-keyboard-title': 'Keyboard',
  'help-keyboard-short': 'Work with the month and switch screens without the mouse',
  'help-keyboard-body': `Almost everything can be done from the keyboard:

- Cmd/Ctrl+N: quick entry; Shift+Cmd/Ctrl+N: new item.
- Cmd/Ctrl+1 to 9: the sections in the order of the menu.
- Cmd/Ctrl+F: search.
- Up, Down: rows of the month; Left, Right: months.
- Space: mark the row done, R: set money aside, X: tick the row.
- Enter: edit the row, Delete: delete it.
- In the month calendar the arrows move between days, Enter opens the day, N adds an item on that day.

The keys are listed at the bottom of the Month screen. On Windows press Ctrl instead of Cmd.`,

  'help-month-calendar-title': 'Month as a calendar',
  'help-month-calendar-short': 'The same month as weeks, with drag and drop',
  'help-month-calendar-body': `The List / Calendar switch on the Month screen shows the month as weeks from Monday to Sunday. Each day shows up to three items with their status and amount (income with a plus, payments with a minus, transfers with an arrow), "+2 more" when there are more, and the day's total.

Click a day for its list with the usual actions: mark done, set aside, edit. Click an item to edit it. Drag a planned or set-aside item to another day to move it.

The account filter and Show cancelled work there too. The app remembers the choice; the phone always shows the list.`,

  'help-inline-edit-title': 'Amount right in the row',
  'help-inline-edit-short': 'Click an amount to change it without opening the dialog',
  'help-inline-edit-body': `On the Month screen click an amount, type the new one and press Enter. Esc leaves it as it was.

Handy when the electricity bill came in a little higher than planned. If the payment is split, the parts follow in proportion.`,

  'help-search-title': 'Search',
  'help-search-short': 'Find any payment by name, note, category or amount',
  'help-search-body': `Search looks through the whole plan: name, note, category, account, tags and amount. Type an amount as 12,50, 12.50 or just 12. Case and accents do not matter: "kava" finds "Káva".

Open it with the Search button in the sidebar or Cmd/Ctrl+F; on the phone with the magnifier at the top. Filters narrow it down by dates, type, account (envelopes included), category, tag, status, or quick entries only.

Under the results you see the totals of what was found. Click a row to edit it.

Tip: a quick way to see how much one subscription or one shop cost over a year.`,

  // Money in and out
  'help-quick-entry-title': 'Quick entry',
  'help-quick-entry-short': 'A small expense or unplanned income in a couple of seconds',
  'help-quick-entry-body': `Quick entry is for what was not planned: coffee, groceries, an unexpected refund. Use the Quick entry button in the sidebar, Cmd/Ctrl+N, or the round plus on the phone.

Choose Expense or Income, type the amount, the category and, if you like, what it was for. Save and add another keeps the dialog open for the next one; More: tags adds a tag.

When the category has a monthly limit, the dialog shows how much of it is left. Category rules fill in the category from the text.`,

  'help-quick-links-title': 'Quick entry from an iPhone Shortcut, Siri or Wallet',
  'help-quick-links-short': 'A link that opens quick entry already filled in',
  'help-quick-links-body': `The web app opens the quick entry dialog when it is opened with a special link. Put it on a button, call it by voice or run it after every card payment.

1. In Settings (on the phone the More tab) find Quick entry from iPhone and press Copy link.
2. In the Shortcuts app make a shortcut with the Open URL action and this link. Name it Expense and say "Hey Siri, expense".
3. For an entry after each payment: Shortcuts, Automation, Transaction, your Wallet cards, Run Immediately, and put the Amount and Merchant variables into the link.

Nothing is saved until you tap Save. The link opens in Safari, so sign in to Google there too, or the entry will not reach the shared budget.`,

  'help-allocation-title': 'Splitting income into envelopes',
  'help-allocation-short': 'How much to move to each envelope until the next income',
  'help-allocation-body': `When the salary arrives, the app offers to split it: it works out how much to move to each envelope to cover the payments up to a date you choose, and marks those payments set aside.

The dialog opens from the message after you mark income done, and with the Split button on the overview and the Accounts screen. Choose where from, the payments up to which date, and tick the ones you want. The bottom line shows what stays free or what is missing.

If there is not enough for everything, untick what can wait.`,

  'help-split-payments-title': 'Split payments',
  'help-split-payments-short': 'One receipt, several categories',
  'help-split-payments-body': `A supermarket receipt of 60€ can be 40€ groceries, 12€ household and 8€ for the kids. That is what splitting is for.

In the payment's dialog press Split and type the parts with their categories. The dialog shows what is left to split and saves once the parts add up.

Balances still see one payment, while category totals, limits, alerts and analytics count each part in its own category. The row shows "Groceries +2" with the parts in a tooltip. When the amount changes (in the row, when marked done or from a statement), the parts follow in proportion.`,

  'help-tags-title': 'Tags and trip budgets',
  'help-tags-short': 'Group spending across categories: a trip, a renovation, a project',
  'help-tags-body': `A tag groups payments from different categories, such as "Weekend in Vienna" or "Renovation". Add it in the payment, recurring payment and quick entry dialogs.

A tag can have a color, a budget and dates. Create and edit them in Settings, Tags and trips. Analytics shows a card per tag: what is spent, what is still planned, how much of the budget is used and on what.

Month and search filter by tag, and ticked rows get a tag added or removed at once. A deleted tag is removed from every entry.`,

  'help-pass-through-title': 'Pass-through money',
  'help-pass-through-short': 'Money of others that only passes through your account',
  'help-pass-through-body': `Sometimes someone sends you money so you can pay a bill for them. It is neither your income nor your expense.

Tick Pass-through in the item's dialog. Such money stays visible on the account but is kept out of income, expenses and analytics, and net worth leaves it out.`,

  'help-category-rules-title': 'Category rules',
  'help-category-rules-short': '"LIDL DEKUJE ZA NAKUP 1234" becomes "Lidl" in Groceries by itself',
  'help-category-rules-body': `A rule says: when the payment text has these words, use this category. Rules work in quick entry and in the statement import.

They live in Settings, Category rules, with the New rule button. Set the text, where to look and how to compare, and optionally the type and an amount range. A rule can also give a readable name instead of the bank's and send the payment to an envelope.

Rules are checked from the top, the first match wins; Move up and Move down change the order. Try a text shows which rule would apply. In the statement import, Always for creates a rule in one click.`,

  'help-bank-import-title': 'Bank statement import',
  'help-bank-import-short': 'Load a CSV from the bank and match every row to the plan',
  'help-bank-import-body': `The import saves you the ticking: the statement marks planned payments done and adds new spending.

1. On the Accounts and envelopes screen press Import statement (or the import icon on an account), pick the account and a CSV file from your online banking.
2. Revolut and most banks are recognised by their column names. If not, pick the date, amount and description columns yourself; the app remembers them for that account.
3. Check every row: Matches plan, Already recorded, New or Skip. You can change the action, match a row to another payment or set its category.
4. Press Apply.

A planned payment of the same amount within 5 days (10% for approximate amounts) is marked done with the bank's amount and date. Importing the same file twice adds nothing, and one click undoes the whole import. When the file has a balance column, the app compares it with its own.`,

  'help-reconcile-title': 'Checking against the bank',
  'help-reconcile-short': 'Type what the bank shows and see the difference',
  'help-reconcile-body': `Checking keeps balances honest. On the Accounts and envelopes screen press Check against the bank and type how much each account holds according to the bank.

Where a number differs, the difference becomes an adjustment on that day, and balances, the month end and the forecast are recalculated. Empty fields change nothing.

Before checking, mark the payments the bank has already made. Otherwise they count twice; the dialog warns about them.`,

  // Accounts and envelopes
  'help-envelopes-title': 'Envelopes',
  'help-envelopes-short': 'Sub-accounts, like the spaces of a banking app',
  'help-envelopes-body': `An envelope is part of the money on an account with its own purpose, such as Bills or Holiday inside the main card.

On the Accounts and envelopes screen press the folder with a plus on an account (Add an envelope). A payment goes to an envelope through the Account field of its dialog.

Money set aside on an envelope belongs to its payments and never counts as free for anything else. Double-click an account row to open its settings.`,

  'help-free-money-title': 'Free money',
  'help-free-money-short': 'How much you can really spend',
  'help-free-money-body': `Free is everything on your accounts minus what is set aside for payments and the money of goals. It is the main number of the app: you can spend it without touching the plan.

It is on the overview, per account and envelope on the Accounts screen, and on the phone's Today tab, with what is set aside and the total on the accounts next to it.

Free money below zero means more is set aside than there is. Time to check the accounts against the bank or revisit the plan.`,

  'help-set-aside-title': 'Setting money aside',
  'help-set-aside-short': 'Reserve money for a payment until it goes out',
  'help-set-aside-body': `Setting aside means: this money is already for this payment. It stays on the account but no longer counts as free.

Press the piggy bank on the payment's row, or R on the selected row. Splitting income sets money aside for many payments at once.

Money set aside for one payment never covers another, which is why the forecast honestly shows where money will run short.`,

  'help-goal-money-title': 'Frozen goal money',
  'help-goal-money-short': 'Money saved for a goal does not count as free',
  'help-goal-money-body': `Money on the account or envelope of an active goal is frozen for it: it does not count as free and is not spent on everyday payments.

On the overview the Set aside card shows it separately: for payments and for goals. A transfer to a goal's account lowers free money but is not an expense.

When a goal is archived, the money on its envelope becomes free again.`,

  'help-tracking-start-title': 'Tracking start',
  'help-tracking-start-short': 'The day account balances are counted from',
  'help-tracking-start-body': `Tracking start is the day account balances are counted from. Anything earlier is history: it shows in the months and in analytics but does not change balances.

It is set on first launch and changed in Settings, Accounting, Tracking starts. The opening balance of every account belongs to that day.

The change affects every balance, so the app asks first, and the change can be undone.`,

  'help-adjustments-title': 'Adjustments',
  'help-adjustments-short': 'The difference from a bank check, visible in the month',
  'help-adjustments-body': `An adjustment appears when a check against the bank finds a difference. It is an ordinary item marked adjustment, so the difference is neither lost nor hidden.

Adjustments are listed with the done rows and summed up on the month card. In analytics, plan against fact shows them separately.

Many adjustments usually mean forgotten small purchases: worth recording them with quick entry.`,

  'help-net-worth-title': 'Net worth',
  'help-net-worth-short': 'What the household owns minus what it owes',
  'help-net-worth-body': `Net worth adds up all accounts (envelopes included, without pass-through money), property and investments and money owed to you, and takes off what is left on loans and debts.

The Accounts and envelopes screen has a Property and investments block: add a flat, a car, an investment account or savings kept elsewhere. Press Update the value now and then; the latest value counts. When something is sold, use Archive (sold), and the past stays as it was.

The Net worth card in Analytics shows the total, the change over the period, the four parts and a line of the month ends. On the phone the total ends the Accounts tab.`,

  // Recurring
  'help-recurring-title': 'Recurring payments',
  'help-recurring-short': 'Rent, salary, subscriptions: the plan for the months ahead builds itself',
  'help-recurring-body': `A recurring payment describes what repeats: monthly, every few months, yearly, on weekdays or once. The plan for the months ahead is built from them.

On the Recurring screen press Recurring payment. Set the amount, account, category, day of the month and how often it repeats. For amounts that vary, tick The amount is approximate, ask for the exact one when marking it done.

When you edit one, Apply the changes to future items updates what is ahead. Past and done items never change. How many months ahead the plan reaches is set in Settings, Accounting, Plan ahead.`,

  'help-every-n-months-title': 'Every few months',
  'help-every-n-months-short': 'A payment every 2, 3 or 6 months, with zero rows in between',
  'help-every-n-months-body': `Water every two months or insurance twice a year: choose Every few months and fill in Every how many months.

Show it in the other months too, with a zero amount puts a zero row into the months in between. The payment is not forgotten, and when a bill does come, just type its amount in the row.`,

  'help-save-ahead-title': 'Saving ahead',
  'help-save-ahead-short': 'Put money aside every month for yearly and rare payments',
  'help-save-ahead-body': `Yearly car insurance should not come as a surprise. Saving ahead turns it into monthly contributions.

1. In the recurring payment's dialog tick Save ahead for this payment, or press the piggy bank on its row on the Recurring screen.
2. Choose where to save (a savings account or an envelope), where the money comes from and on which day.
3. The app creates a goal for the payment's next date with a monthly contribution.

From then on the payment is paid from that envelope, where its money lies frozen for it. The row shows "saved 180€ of 420€, 60€ a month". Once the payment is marked done, the goal moves on to the next date. Stop saving ahead, or deleting the payment, archives the goal and hands the payment back to its old account.`,

  'help-recurring-overview-title': 'Recurring costs overview',
  'help-recurring-overview-short': 'What subscriptions and bills cost a year and how prices changed',
  'help-recurring-overview-body': `The All / Overview switch on the Recurring screen lists recurring expenses by what they cost a year.

For each you see the amount per month (a yearly payment counts a twelfth, every N months an Nth, weekly ones 52 times a year), per year, the next charge and the price history from the payments marked done, such as "was 9.99€, now 12.99€, +30%". Totals are at the bottom and a category filter at the top.

Tip: look here once a quarter; it is the fastest way to find a forgotten subscription.`,

  // Planning and control
  'help-overview-title': 'Overview',
  'help-overview-short': 'Free money, overdue items, today and the next week',
  'help-overview-body': `The overview answers "how are we doing right now". At the top are four cards: Free, Set aside, In accounts and End of month, which is what stays free if everything goes to plan.

Below are overdue items, today's payments and the next 7 days, the forecast, this month's plan and the table of accounts and envelopes. When something needs a look, an Attention card appears.

On the phone the same comes in short on the Today tab.`,

  'help-forecast-title': 'Free money forecast',
  'help-forecast-short': 'A chart of free money for the months ahead',
  'help-forecast-body': `The chart on the overview shows how free money changes day by day if everything goes to plan: income comes in, payments with nothing set aside go out.

Above the chart you see what is left at the end of the forecast. How far it looks is set in Settings, Accounting, Plan ahead.

When the line dips below zero, find the payment that pulls it down and move it or set money aside for it early.`,

  'help-first-shortfall-title': 'The first payment without enough money',
  'help-first-shortfall-short': 'A red bar on the overview with the name, date and shortage',
  'help-first-shortfall-body': `The app walks forward through the plan and finds the first payment that free money will not cover. A red bar on the overview names it, with the amount, the date and what is missing.

Money set aside for other payments does not count here: it is already taken. So the warning comes early, not on the day of the payment.

What you can do: move the payment, lower it, move money from a less urgent envelope or wait for income.`,

  'help-runway-title': 'Runway',
  'help-runway-short': 'How many days free money lasts at your usual spending',
  'help-runway-body': `Under the Free number on the overview and the phone there is a line such as "Runway: 45 days at usual spending". It is free money divided by the average daily spending of the last 90 days.

Hover it to see the average it is based on. Without any spending yet there is nothing to count, and the line says so.

It is a guide for when income is late, not a promise: large rare payments are smoothed out in the average.`,

  'help-alerts-title': 'Alerts',
  'help-alerts-short': 'A limit almost used, little free money, a large payment soon',
  'help-alerts-body': `An Attention card appears on the overview and on the phone's Today tab when:

- a category reaches 80% or 100% of its monthly limit;
- free money drops below a threshold;
- a large payment is due within 3 days.

Switch them on and set them in Settings, Reminders: the free money threshold (100€ by default) and what counts as a large payment (above 500€). An empty field turns that alert off. On the computer each one also comes as a notification, at most once a day.`,

  'help-what-if-title': 'What if',
  'help-what-if-short': 'Try a purchase or a new payment on the forecast without touching the plan',
  'help-what-if-body': `What if shows what happens to free money if you buy a laptop for 1 200€ in December or join a gym for 40€ a month for six months.

Press What if above the forecast chart and add a draft: the amount, the date, once or monthly and for how many months. Switched-on drafts draw a second, dashed line on the chart, and the text under it says where free money is lowest and whether it goes below zero.

Balances, Month, totals, alerts and reminders never see drafts. Add to the plan turns a draft into an item (once) or a recurring payment (monthly), with undo.`,

  'help-limits-title': 'Monthly limits with rollover',
  'help-limits-short': 'How much a category may spend in a month',
  'help-limits-body': `An expense category can have a monthly limit. You see it in quick entry ("54€ left of the limit"), in analytics and in alerts.

Set it in Settings, Categories, in the Monthly limit column. Next to it, At the end of the month offers:

- Start over: the limit begins from zero each month;
- Carry over what is left: unspent money adds to the next month;
- Carry over both ways: overspending is taken off the next month too.

Carrying starts in the month the option is switched on. Under the limit you then see, for example, "This month: 54€ with 14€ carried over".`,

  'help-month-plan-title': 'This month\'s plan',
  'help-month-plan-short': 'How much income has come in and how much has gone out',
  'help-month-plan-body': `The This month's plan card on the overview compares the fact with the plan: income "1 800€ of 2 400€, 600€ still expected", expenses "900€ of 1 500€, 600€ still to pay".

When expenses run over the plan, the card says so and highlights the line. Small spending is shown on a separate line.

Tip: in the middle of the month it is the quickest way to see whether you are on track.`,

  // Analytics
  'help-analytics-months-title': 'Income and expenses by month',
  'help-analytics-months-short': 'A chart of the months and the totals of the period',
  'help-analytics-months-body': `The Analytics screen starts with the totals of the period: income, expenses, the result and the average spending per month, and a chart of income and expenses month by month.

Choose the period at the top, up to the whole history. Only what is done counts, small spending included, pass-through money left out.

Analytics appears once there is some income and spending marked done.`,

  'help-analytics-categories-title': 'Expenses by category',
  'help-analytics-categories-short': 'Where the money goes and how much on average',
  'help-analytics-categories-body': `The Expenses by category table shows how much went to each category over the period, its share and the averages over 3, 6 and 12 months.

Parts of split payments count in their own categories. The averages are a good basis for monthly limits.`,

  'help-income-sources-title': 'Income by source',
  'help-income-sources-short': 'Where the money comes from',
  'help-income-sources-body': `The Income by source table in analytics splits the income of the period by income category: salary, side jobs, refunds and so on, each with its share.

A source is an income category, so set one in quick entries of income too.`,

  'help-plan-fact-title': 'Plan against fact',
  'help-plan-fact-short': 'What you meant to spend and what you spent',
  'help-plan-fact-body': `The Plan and fact of expenses table compares, month by month, the planned payments with what actually happened and shows the difference.

Plan is the month's planned payments without small spending; fact is everything done, small spending included. Adjustments from bank checks have their own column. Below, Limits shows how this month's category limits stand.`,

  'help-money-flow-title': 'Money flow',
  'help-money-flow-short': 'A diagram of where the money came from and where it went',
  'help-money-flow-body': `The Money flow card in analytics draws the flows: income sources on the left flow into Income, which flows out to the largest expense categories (the rest grouped into Other) and to what was saved. When more went out than came in, a From savings flow appears.

Choose Last month, This month or Whole period. Hover a band for the amount and share.

Under the diagram the same is said in text, and Show as a table opens a table. Narrow windows get a two-column list instead.`,

  'help-tag-analytics-title': 'Tags and trips in analytics',
  'help-tag-analytics-short': 'A card per tag: spent, planned, budget',
  'help-tag-analytics-body': `The Tags and trips part of analytics has a card per tag: what is spent, what is still planned, how much of the budget is used and spending by category inside the tag.

The bar shows what is spent and, lighter, what is planned. Refunds are counted separately. Handy after a holiday: you see at once what it cost.`,

  // Goals and debts
  'help-goals-title': 'Goals',
  'help-goals-short': 'An amount, an envelope and a date: how much to save a month',
  'help-goals-body': `A goal ties an amount to the envelope you save on and a date. The app shows how much is there, how much is left and how much to put aside per month.

On the Goals screen press New goal and fill in How much, Account or envelope and By when. What is saved is the balance of that envelope.

Add a contribution to the plan puts a monthly transfer to the goal's account into the plan until the date; it shows in Month, reminders and the forecast. When the plan falls short, the goal says so and raises the contribution in one click.`,

  'help-debts-title': 'Debts and loans',
  'help-debts-short': 'What is left, what is paid and when it ends',
  'help-debts-body': `The Debts and loans screen keeps a car loan, a mortgage or money a friend owes you. Each shows what is left, a bar such as "38% paid", the monthly payment, the rate, when it is paid off at the current payment and how much interest is still to come.

1. Press New debt, choose I pay it off or Owed to me, type the amount, rate and payment.
2. Make it a recurring payment puts the payment into the plan. Payments count when they are done: entries marked with the debt in the Debt field and the entries of its recurring payment.
3. Update balance takes the amount from the bank's statement as a new starting point.

The Payoff planner shows what extra money per month does: the order to pay off (highest rate first or smallest first), when each one ends and how many months and how much interest that saves. On the phone the Accounts tab lists the debts.`,

  // Sync and safety
  'help-sync-title': 'Google sign-in and sync',
  'help-sync-short': 'One budget on every computer and the phone',
  'help-sync-body': `Sign in with Google in Settings, Sync (on the phone the More tab), and the budget is the same wherever you sign in with that account.

The budget is one file in a hidden app folder on your Google Drive that other apps cannot see. On launch and while open, the app only takes changes; it sends its own when the window closes, when you quit and with Sync now.

When both copies changed, they are merged record by record and nothing is lost. Without a connection everything keeps working and goes up later.`,

  'help-encryption-title': 'Encrypting the Drive file',
  'help-encryption-short': 'Nobody reads the copy in Drive without your password',
  'help-encryption-body': `Settings, Sync, Encrypt the file in Google Drive encrypts the copy in your Drive with a password you choose. Google, or anyone who gets into your Drive, sees only encrypted bytes.

Every device asks for the password once. The computer keeps the key (never the password) in the system keychain, the phone in the browser's storage. A device without the password pauses sync and leaves the file alone. The same place changes the password or makes a device forget it.

Important: a forgotten password cannot be recovered. Nobody can open the copy in Drive any more, and only the budgets on your devices remain. Encryption does not protect the budget on the devices themselves.`,

  'help-backups-title': 'Backups and restore',
  'help-backups-short': 'A copy every day and a manual copy in one file',
  'help-backups-body': `The desktop app keeps a copy of the budget every day (the last 14) and a separate copy before the whole budget is ever replaced.

In Settings, Data:

- Backup, Download: the whole budget in one file;
- Restore from a backup: replace the budget with a file (a copy is kept first, and the restore can be undone);
- Automatic backups, Open: open the folder with the daily copies.

A restore is a change like any other and reaches your other devices through sync.`,

  'help-journal-title': 'Change journal',
  'help-journal-short': 'What changed in 90 days, and undo for any step',
  'help-journal-body': `The journal shows what changed on this device in the last 90 days, day by day. Each line is one step: a click, a bulk action, an import, a sync, with its time, where it came from and a short text such as Payment "Rent" 950€: amount 900€ → 950€.

Open it in Settings, Data, Change journal (on the phone the More tab). Filter by kind of record and source, or search.

Undo this change takes a whole step back; Restore this version brings one record back. First the app shows what will change and warns when a record was changed again later. The journal itself stays on the device and is not synced.`,

  'help-csv-export-title': 'CSV export',
  'help-csv-export-short': 'All items as a table for Excel or Google Sheets',
  'help-csv-export-body': `Settings, Data, CSV spreadsheet, Export saves every item in one file: date, name, type, amount, account, category, status, note and tags.

A split payment comes out as one line per part, marked 1/3, 2/3, 3/3, so the category totals add up.`,

  'help-demo-title': 'Demo budget',
  'help-demo-short': 'A made-up household to try everything without risk',
  'help-demo-body': `The demo is a made-up household with half a year of budget: accounts, envelopes, recurring payments, goals, debts. A good place to try any feature.

It opens on first launch (Look around first) or in Settings, Data, Demo data, Show the demo. The demo replaces the current budget; a copy is kept first, and the replacement can be undone.

When you are done, Delete everything in the same section starts with a clean slate.`,

  // Phone and reminders
  'help-phone-app-title': 'The phone app',
  'help-phone-app-short': 'Today\'s payments, ticking off and quick entries in your pocket',
  'help-phone-app-body': `On the phone WE Budget opens in the browser and works together with the computer: today's and overdue payments, marking them, search, quick entries of expenses and income, balances, debts and net worth.

1. Open jaffarsk24.github.io/WE-Budget/app in Safari on the iPhone, or in Chrome on Android.
2. Tap Share, then Add to Home Screen (Chrome: the menu, then Add to Home screen).
3. Open WE Budget from the home screen and sign in with the same Google account as on the computer.

The plan, recurring payments and accounts are edited on the computer. The budget stays on the phone and works offline.`,

  'help-reminders-title': 'Reminders in Google Calendar',
  'help-reminders-short': 'A reminder about unmarked payments reaches your phone',
  'help-reminders-body': `In Settings, Reminders, choose the time (23:00 by default) and switch on Remind me through Google Calendar.

The app creates its own calendar, "WE Budget", in your Google account and puts an event with a reminder on every day that still has payments not marked. Google sends the reminder, so it reaches your phone even when every computer is off.

The app cannot see your other calendars, and switching the reminders off deletes its calendar.`,

  'help-notifications-title': 'Desktop notifications and the morning digest',
  'help-notifications-short': 'A notification on the computer at your time and at 8:00',
  'help-notifications-body': `While the desktop app is open, it can show a notification about unmarked payments at the reminder time, and a morning summary of the day's payments at 8:00.

Switch them on in Settings, Reminders: Notification on this computer and Morning summary. Alerts about limits and large payments come as notifications too, at most once a day.`,

  'help-menu-bar-title': 'Menu bar',
  'help-menu-bar-short': 'Free money next to the clock, with a quick entry',
  'help-menu-bar-body': `On the Mac the app shows free money next to an icon in the menu bar, on Windows in the notification area. Its menu has a quick entry.

Switch it on or off in Settings, Appearance, Show free money in the menu bar.`,

  'help-updates-title': 'Updates',
  'help-updates-short': 'New versions are offered right in the app',
  'help-updates-body': `On start the app checks for a new version. When there is one, a banner offers Update and What is new.

The app downloads the build for your system, verifies it, replaces itself and starts again. Before it closes, it sends unsent changes to Google Drive.

To check by hand, use Settings, Updates, Check for updates.`
};
