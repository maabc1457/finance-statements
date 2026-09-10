import json
import os

from django.conf import settings
from django.shortcuts import render

STATIC_JS_DIR = os.path.join(settings.BASE_DIR, 'statements', 'static', 'statements', 'js')


def _asset_version():
    """Cache-busting token for engine.js/ui.js so an edit during development
    is never masked by a browser serving a stale cached copy of the script."""
    try:
        return int(max(
            os.path.getmtime(os.path.join(STATIC_JS_DIR, name))
            for name in ('engine.js', 'ui.js')
        ))
    except OSError:
        return 0

EFFICIENCY_TABLE = {
    1: {'label': 'Low', 'cogs_pct': 0.55, 'opex_pct': 0.30},
    2: {'label': 'Medium', 'cogs_pct': 0.50, 'opex_pct': 0.25},
    3: {'label': 'High', 'cogs_pct': 0.45, 'opex_pct': 0.20},
    4: {'label': 'Very High', 'cogs_pct': 0.40, 'opex_pct': 0.15},
}

TAX_RATE = 0.25

# Beginning-of-year balance sheet. Fixed - only the levers below change year-end results.
BASE = {
    'cash_boy': 50000,
    'receivables_inventory': 30000,
    'gross_ppe_boy': 200000,
    'accum_dep_boy': 60000,
    'liabilities': 90000,
    'common_stock': 60000,
    'dividends': 10000,
}
BASE['retained_earnings_boy'] = (
    BASE['cash_boy'] + BASE['receivables_inventory']
    + (BASE['gross_ppe_boy'] - BASE['accum_dep_boy'])
    - BASE['liabilities'] - BASE['common_stock']
)

DEFAULT_LEVERS = {
    'revenue': 150000,
    'capex': 20000,
    'depreciation': 15000,
    'efficiency': 2,
}


def compute_statements(base, levers):
    """Recomputes all three statements from the fixed base plus the current
    lever values. Never applies deltas on top of a previous result, so the
    balance sheet balances no matter what order the levers were touched in."""
    eff = EFFICIENCY_TABLE[levers['efficiency']]
    revenue = levers['revenue']
    capex = levers['capex']
    depreciation = levers['depreciation']

    cogs = revenue * eff['cogs_pct']
    gross_profit = revenue - cogs
    opex = revenue * eff['opex_pct']
    operating_income = gross_profit - opex
    ebt = operating_income - depreciation
    tax = ebt * TAX_RATE
    net_income = ebt - tax

    cfo = net_income + depreciation
    cfi = -capex
    cff = -base['dividends']
    net_change_in_cash = cfo + cfi + cff
    cash_end = base['cash_boy'] + net_change_in_cash

    gross_ppe_end = base['gross_ppe_boy'] + capex
    accum_dep_end = base['accum_dep_boy'] + depreciation
    net_ppe_end = gross_ppe_end - accum_dep_end

    total_assets = cash_end + base['receivables_inventory'] + net_ppe_end
    retained_earnings_end = base['retained_earnings_boy'] + net_income - base['dividends']
    total_equity = base['common_stock'] + retained_earnings_end
    total_liab_and_equity = base['liabilities'] + total_equity

    return {
        'income_statement': {
            'revenue': revenue,
            'cogs': cogs,
            'gross_profit': gross_profit,
            'opex': opex,
            'operating_income': operating_income,
            'depreciation': depreciation,
            'ebt': ebt,
            'tax': tax,
            'net_income': net_income,
        },
        'balance_sheet': {
            'cash': cash_end,
            'receivables_inventory': base['receivables_inventory'],
            'gross_ppe': gross_ppe_end,
            'accum_dep': accum_dep_end,
            'net_ppe': net_ppe_end,
            'total_assets': total_assets,
            'liabilities': base['liabilities'],
            'common_stock': base['common_stock'],
            'retained_earnings': retained_earnings_end,
            'total_equity': total_equity,
            'total_liab_and_equity': total_liab_and_equity,
        },
        'cash_flow': {
            'net_income': net_income,
            'depreciation_addback': depreciation,
            'cfo': cfo,
            'capex': capex,
            'cfi': cfi,
            'dividends': base['dividends'],
            'cff': cff,
            'net_change_in_cash': net_change_in_cash,
            'cash_boy': base['cash_boy'],
            'cash_eoy': cash_end,
        },
    }


def landing(request):
    return render(request, 'statements/landing.html')


def workspace(request):
    statements = compute_statements(BASE, DEFAULT_LEVERS)
    current_efficiency = EFFICIENCY_TABLE[DEFAULT_LEVERS['efficiency']]
    context = {
        'base_json': json.dumps(BASE),
        'levers_json': json.dumps(DEFAULT_LEVERS),
        'efficiency_table_json': json.dumps(EFFICIENCY_TABLE),
        'tax_rate_json': json.dumps(TAX_RATE),
        'tax_rate_pct': round(TAX_RATE * 100),
        'levers': DEFAULT_LEVERS,
        'statements': statements,
        'current_efficiency': {
            'label': current_efficiency['label'],
            'cogs_pct': round(current_efficiency['cogs_pct'] * 100),
            'opex_pct': round(current_efficiency['opex_pct'] * 100),
        },
        'asset_version': _asset_version(),
    }
    return render(request, 'statements/workspace.html', context)
