# Financial Statement Flow Tool

## Project Overview
A Django app letting users take three made up or typed in financial statements, and allowing them to change certain numbers to see in real time how changed reverberate through the financial statements. Users should be able to change Revenue, CapEx, Useful Life (which drives Depreciation), and Long-Term Debt and have it so that changes can be made on top of each other without the underlying math every breaking. The reverberation should focus on only that years balance sheets. Furthemore in the income statement, there must be a slider with four points that allows a person to choose between different company efficency settings. If a company is highly efficient with their expenses and COGS, it must give them greater margin in terms of how their revenue translates to net income, this conversion gets less efficient as the user slides backwards. 

## Tech Stack
- Django (see requirements.txt for exact version)
- Vanilla JavaScript for interactivity (no frontend framework). The interactivity should withstand user capabilities outlined in this document. Because changes must be able to work on top of changes, you may want a state tracking snipped to ensure that the math of the statement never falls out of balance. 
- Deployed on Render (whitenoise for static files, gunicorn as the server)

## Key Conventions
- **Revenue Lever:**
   - Updates Gross Revenue which Feeds into Efficiency Slider calculation Outputs Net Income after dealing with all operating expenses, and tax and interest.
   - Net Income flows to **Retained Earnings** (Equity) and increases/decreases **Cash** (Assets).

- **CapEx Lever:**
   - Increases **Gross PP&E** (Assets).
   - Decreases **Cash** (Assets) via the Cash Flow from Investing section.
   - Also raises Depreciation, since Depreciation is calculated from Gross PP&E (see below).

-  **Useful Life Lever / Depreciation:**
   - Depreciation is NOT a direct lever. It is straight-line: **Depreciation = Gross PP&E (opening + this year's CapEx) ÷ Useful Life**. The Useful Life slider (5-25 years) is the control; shorter life = more depreciation.
   - Reduces Net Income on the Income Statement (reducing Retained Earnings).
   - Increases **Accumulated Depreciation**, reducing **Net PP&E** (Assets). The balance sheet shows Gross PP&E, accumulated depreciation and Net PP&E, plus a note that "at this year's charge, Net PP&E lasts ≈ X more years" (Net PP&E ÷ this year's depreciation). This is NOT years left in the useful life: the opening accumulated depreciation is fixed history and is never restated when Useful Life changes; only this year's and future charges are recalibrated.
   - Added back as a non-cash expense on the **Cash Flow Statement** (reconciling the Cash asset balance).
   - The app models one year only; straight-line means every year's charge is the same, which the Depreciation line states.

- **Long-Term Debt Lever:**
   - Sets the year-end **Long-Term Debt** balance, the only liability on the balance sheet.
   - **Interest Expense** = 6% × that balance (borrowing/repayment is treated as happening at the start of the year). It sits between EBIT and EBT, so it reduces EBT, Tax and Net Income (and therefore Retained Earnings and Cash). It is a cash cost, so it is NOT added back on the Cash Flow Statement.
   - The difference from the opening debt balance is **Debt issued / (repaid)** in Cash Flow from Financing, increasing/decreasing **Cash**.

- Currency values are displayed using Django's `humanize` `intcomma` filter combined with `floatformat:0`. This is done to ensure all numbers show up as clean monetary figures. 

## Things to Watch For
- The indication of a flow or change in another number must always be clear and easily readable by the user, must use a nice green/red to indicate whether a changing number down the statements has gone up or down
- Ensure that all three financial statements: income statement, balance sheet, and cash flow statement are neatly formatted, detailed, and user friendly to read. 
- MUST WATCH: You must ensure that at no times does the underlying logic of how financial statements flow break, i.e. if a user changes capex and then depreciation or goes back and forth the statement must always balance and make sense while showing the user, exactly what their changes did. 