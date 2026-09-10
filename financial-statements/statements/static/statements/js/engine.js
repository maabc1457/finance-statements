// Pure calculation engine. Every call recomputes all three statements from
// the fixed beginning-of-year `base` plus the *current* lever values - never
// from the previous result - so the books stay in balance no matter what
// order Revenue / CapEx / Depreciation / Efficiency were changed in, or how
// many times they're flipped back and forth.

const EFFICIENCY_TABLE = {
  1: { label: 'Low', cogsPct: 0.55, opexPct: 0.30 },
  2: { label: 'Medium', cogsPct: 0.50, opexPct: 0.25 },
  3: { label: 'High', cogsPct: 0.45, opexPct: 0.20 },
  4: { label: 'Very High', cogsPct: 0.40, opexPct: 0.15 },
};

const TAX_RATE = 0.25;

function computeStatements(base, levers) {
  const eff = EFFICIENCY_TABLE[levers.efficiency];
  const revenue = levers.revenue;
  const capex = levers.capex;
  const depreciation = levers.depreciation;

  const cogs = revenue * eff.cogsPct;
  const grossProfit = revenue - cogs;
  const opex = revenue * eff.opexPct;
  const operatingIncome = grossProfit - opex;
  const ebt = operatingIncome - depreciation;
  const tax = ebt * TAX_RATE;
  const netIncome = ebt - tax;

  const cfo = netIncome + depreciation;
  const cfi = -capex;
  const cff = -base.dividends;
  const netChangeInCash = cfo + cfi + cff;
  const cashEnd = base.cash_boy + netChangeInCash;

  const grossPpeEnd = base.gross_ppe_boy + capex;
  const accumDepEnd = base.accum_dep_boy + depreciation;
  const netPpeEnd = grossPpeEnd - accumDepEnd;

  const totalAssets = cashEnd + base.receivables_inventory + netPpeEnd;
  const retainedEarningsEnd = base.retained_earnings_boy + netIncome - base.dividends;
  const totalEquity = base.common_stock + retainedEarningsEnd;
  const totalLiabAndEquity = base.liabilities + totalEquity;

  return {
    efficiencyLabel: eff.label,
    is_revenue: revenue,
    is_cogs: cogs,
    is_gross_profit: grossProfit,
    is_opex: opex,
    is_operating_income: operatingIncome,
    is_depreciation: depreciation,
    is_ebt: ebt,
    is_tax: tax,
    is_net_income: netIncome,

    bs_cash: cashEnd,
    bs_receivables_inventory: base.receivables_inventory,
    bs_gross_ppe: grossPpeEnd,
    bs_accum_dep: accumDepEnd,
    bs_net_ppe: netPpeEnd,
    bs_total_assets: totalAssets,
    bs_liabilities: base.liabilities,
    bs_common_stock: base.common_stock,
    bs_retained_earnings: retainedEarningsEnd,
    bs_total_equity: totalEquity,
    bs_total_liab_equity: totalLiabAndEquity,

    cf_net_income: netIncome,
    cf_depreciation_addback: depreciation,
    cf_cfo: cfo,
    cf_cfi: capex,
    cf_cff: base.dividends,
    cf_net_change: netChangeInCash,
    cf_cash_boy: base.cash_boy,
    cf_cash_eoy: cashEnd,

    balance_diff: totalAssets - totalLiabAndEquity,
  };
}
