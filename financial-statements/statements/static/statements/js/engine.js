// Pure calculation engine. Every call recomputes all three statements from
// the fixed beginning-of-year `base` plus the *current* lever values - never
// from the previous result - so the books stay in balance no matter what
// order Revenue / CapEx / Useful Life / Efficiency / Debt were changed in, or how
// many times they're flipped back and forth.

const EFFICIENCY_TABLE = {
  1: { label: 'Low', cogsPct: 0.55, opexPct: 0.30 },
  2: { label: 'Medium', cogsPct: 0.50, opexPct: 0.25 },
  3: { label: 'High', cogsPct: 0.45, opexPct: 0.20 },
  4: { label: 'Very High', cogsPct: 0.40, opexPct: 0.15 },
};

const TAX_RATE = 0.25;

// Charged on the year-end Long-Term Debt balance (the Debt lever - the only
// liability). Any borrowing/repayment is treated as happening at the start of
// the year, so the new balance carries a full year of interest.
const INTEREST_RATE = 0.06;

function computeStatements(base, levers) {
  const eff = EFFICIENCY_TABLE[levers.efficiency];
  const revenue = levers.revenue;
  const capex = levers.capex;
  const usefulLife = levers.useful_life;
  const debt = levers.debt;

  // Straight-line depreciation on everything owned this year: the opening
  // Gross PP&E plus this year's CapEx (bought at the start of the year).
  const grossPpeEnd = base.gross_ppe_boy + capex;
  const depreciation = grossPpeEnd / usefulLife;

  const cogs = revenue * eff.cogsPct;
  const grossProfit = revenue - cogs;
  const opex = revenue * eff.opexPct;
  const operatingIncome = grossProfit - opex;
  const ebit = operatingIncome - depreciation;
  const interest = debt * INTEREST_RATE;
  const ebt = ebit - interest;
  const tax = ebt * TAX_RATE;
  const netIncome = ebt - tax;

  const cfo = netIncome + depreciation;
  const cfi = -capex;
  // Borrowing brings cash in, repaying sends it out - this is what keeps the
  // balance sheet balanced when the Debt lever moves.
  const debtChange = debt - base.long_term_debt_boy;
  const cff = debtChange - base.dividends;
  const netChangeInCash = cfo + cfi + cff;
  const cashEnd = base.cash_boy + netChangeInCash;

  const accumDepEnd = base.accum_dep_boy + depreciation;
  const netPpeEnd = grossPpeEnd - accumDepEnd;

  const totalAssets = cashEnd + base.receivables_inventory + netPpeEnd;
  const retainedEarningsEnd = base.retained_earnings_boy + netIncome - base.dividends;
  const totalEquity = base.common_stock + retainedEarningsEnd;
  const totalLiabilities = debt;
  const totalLiabAndEquity = totalLiabilities + totalEquity;

  return {
    efficiencyLabel: eff.label,
    is_revenue: revenue,
    is_cogs: cogs,
    is_gross_profit: grossProfit,
    is_opex: opex,
    is_operating_income: operatingIncome,
    is_depreciation: depreciation,
    is_useful_life: usefulLife,
    is_ebit: ebit,
    is_interest: interest,
    is_ebt: ebt,
    is_tax: tax,
    is_net_income: netIncome,

    bs_cash: cashEnd,
    bs_receivables_inventory: base.receivables_inventory,
    bs_gross_ppe: grossPpeEnd,
    bs_accum_dep: accumDepEnd,
    bs_net_ppe: netPpeEnd,
    bs_remaining_life: netPpeEnd / depreciation, // years of depreciation left at this year's rate
    bs_total_assets: totalAssets,
    bs_long_term_debt: debt,
    bs_total_liabilities: totalLiabilities,
    bs_common_stock: base.common_stock,
    bs_retained_earnings: retainedEarningsEnd,
    bs_total_equity: totalEquity,
    bs_total_liab_equity: totalLiabAndEquity,

    cf_net_income: netIncome,
    cf_depreciation_addback: depreciation,
    cf_cfo: cfo,
    cf_cfi: capex,
    cf_debt_change: debtChange,
    cf_dividends: base.dividends,
    cf_cff: cff,
    cf_net_change: netChangeInCash,
    cf_cash_boy: base.cash_boy,
    cf_cash_eoy: cashEnd,

    balance_diff: totalAssets - totalLiabAndEquity,
  };
}
