import itertools

from django.test import TestCase, override_settings
from django.urls import reverse

from .views import BASE, DEFAULT_LEVERS, INTEREST_RATE, TAX_RATE, compute_statements


class InterestExpenseTests(TestCase):
    def test_interest_is_rate_times_long_term_debt(self):
        for debt in (0, 90000, 250000):
            result = compute_statements(BASE, dict(DEFAULT_LEVERS, debt=debt))
            self.assertAlmostEqual(result['income_statement']['interest'], debt * INTEREST_RATE)

    def test_interest_sits_between_ebit_and_ebt(self):
        inc = compute_statements(BASE, DEFAULT_LEVERS)['income_statement']
        self.assertAlmostEqual(inc['ebit'], inc['operating_income'] - inc['depreciation'])
        self.assertAlmostEqual(inc['ebt'], inc['ebit'] - inc['interest'])

    def test_interest_only_moves_with_debt_lever(self):
        a = compute_statements(BASE, DEFAULT_LEVERS)
        b = compute_statements(BASE, dict(DEFAULT_LEVERS, revenue=300000, capex=100000, useful_life=5, efficiency=4))
        self.assertEqual(a['income_statement']['interest'], b['income_statement']['interest'])

    def test_total_liabilities_is_long_term_debt(self):
        bs = compute_statements(BASE, dict(DEFAULT_LEVERS, debt=150000))['balance_sheet']
        self.assertEqual(bs['long_term_debt'], 150000)
        self.assertEqual(bs['total_liabilities'], 150000)


class DebtLeverTests(TestCase):
    def test_default_debt_matches_opening_balance(self):
        cf = compute_statements(BASE, DEFAULT_LEVERS)['cash_flow']
        self.assertEqual(cf['debt_change'], 0)
        self.assertEqual(cf['cff'], -BASE['dividends'])

    def test_borrowing_flows_through_every_statement(self):
        extra = 60000
        before = compute_statements(BASE, DEFAULT_LEVERS)
        after = compute_statements(BASE, dict(DEFAULT_LEVERS, debt=BASE['long_term_debt_boy'] + extra))
        after_tax_interest = extra * INTEREST_RATE * (1 - TAX_RATE)

        # Income statement: more interest -> lower EBT, tax and net income.
        self.assertAlmostEqual(
            after['income_statement']['interest'] - before['income_statement']['interest'], extra * INTEREST_RATE)
        self.assertAlmostEqual(
            before['income_statement']['net_income'] - after['income_statement']['net_income'], after_tax_interest)

        # Cash flow: borrowed cash comes in through financing, interest goes out through operations.
        self.assertEqual(after['cash_flow']['debt_change'], extra)
        self.assertAlmostEqual(
            after['cash_flow']['cash_eoy'] - before['cash_flow']['cash_eoy'], extra - after_tax_interest)

        # Balance sheet: debt up, retained earnings down by the after-tax interest.
        self.assertEqual(after['balance_sheet']['long_term_debt'] - before['balance_sheet']['long_term_debt'], extra)
        self.assertAlmostEqual(
            before['balance_sheet']['retained_earnings'] - after['balance_sheet']['retained_earnings'],
            after_tax_interest)

    def test_repaying_debt_uses_cash(self):
        cf = compute_statements(BASE, dict(DEFAULT_LEVERS, debt=40000))['cash_flow']
        self.assertEqual(cf['debt_change'], -50000)
        self.assertEqual(cf['cff'], -50000 - BASE['dividends'])


class DepreciationTests(TestCase):
    def test_depreciation_is_gross_ppe_over_useful_life(self):
        result = compute_statements(BASE, dict(DEFAULT_LEVERS, capex=40000, useful_life=12))
        gross = BASE['gross_ppe_boy'] + 40000
        self.assertEqual(result['balance_sheet']['gross_ppe'], gross)
        self.assertAlmostEqual(result['income_statement']['depreciation'], gross / 12)

    def test_capex_raises_depreciation(self):
        low = compute_statements(BASE, dict(DEFAULT_LEVERS, capex=0))
        high = compute_statements(BASE, dict(DEFAULT_LEVERS, capex=100000))
        self.assertAlmostEqual(
            high['income_statement']['depreciation'] - low['income_statement']['depreciation'],
            100000 / DEFAULT_LEVERS['useful_life'])

    def test_shorter_life_means_more_depreciation_and_same_cash_before_tax(self):
        long_life = compute_statements(BASE, dict(DEFAULT_LEVERS, useful_life=25))
        short_life = compute_statements(BASE, dict(DEFAULT_LEVERS, useful_life=5))
        extra_dep = short_life['income_statement']['depreciation'] - long_life['income_statement']['depreciation']
        self.assertGreater(extra_dep, 0)
        # Depreciation is non-cash: cash only changes through the tax it saves.
        self.assertAlmostEqual(
            short_life['cash_flow']['cash_eoy'] - long_life['cash_flow']['cash_eoy'], extra_dep * TAX_RATE)
        # Accumulated depreciation picks up exactly this year's extra charge.
        self.assertAlmostEqual(
            short_life['balance_sheet']['accum_dep'] - long_life['balance_sheet']['accum_dep'], extra_dep)

    def test_remaining_life(self):
        bs = compute_statements(BASE, DEFAULT_LEVERS)['balance_sheet']
        inc = compute_statements(BASE, DEFAULT_LEVERS)['income_statement']
        self.assertAlmostEqual(bs['remaining_life'], bs['net_ppe'] / inc['depreciation'])


class BalanceTests(TestCase):
    def test_balance_sheet_balances_across_lever_combinations(self):
        for revenue, capex, life, eff, debt in itertools.product(
            (50000, 150000, 300000), (0, 20000, 100000), (5, 15, 25), (1, 2, 3, 4), (0, 90000, 300000),
        ):
            levers = {'revenue': revenue, 'capex': capex, 'useful_life': life, 'efficiency': eff, 'debt': debt}
            bs = compute_statements(BASE, levers)['balance_sheet']
            self.assertAlmostEqual(bs['total_assets'], bs['total_liab_and_equity'], msg=levers)


# The production manifest storage needs `collectstatic` to have run first.
@override_settings(STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class WorkspaceViewTests(TestCase):
    def test_workspace_renders_interest_and_debt_rows(self):
        response = self.client.get(reverse('statements:workspace'), secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'data-field="is_interest"')
        self.assertContains(response, 'data-field="is_ebit"')
        self.assertContains(response, 'data-field="bs_long_term_debt"')
        self.assertContains(response, 'data-field="bs_total_liabilities"')
        self.assertContains(response, 'id="debt-lever"')
        self.assertContains(response, 'id="useful-life-lever"')
        self.assertNotContains(response, 'id="depreciation-lever"')
        self.assertContains(response, 'data-field="bs_gross_ppe"')
        self.assertContains(response, 'data-field="bs_accum_dep"')
        self.assertContains(response, 'data-field="cf_debt_change"')
