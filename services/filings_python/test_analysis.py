import unittest
from .analysis import Extraction, analyze

class AnalysisTest(unittest.TestCase):
    def test_annual_facts_and_missing_metrics(self):
        def fact(metric, value, end='2025-12-31', start='2025-01-01', currency='CHF'):
            return dict(metric=metric, value=value, currency=currency, unit_multiplier=1_000,
                        fiscal_period_end=end, fiscal_period_start=start, page=16, quote=f'{metric} {value}')
        data = Extraction(issuer_name='Example AG', facts=[fact('revenue', 100), fact('operating_income', 20),
            fact('revenue', 90, '2024-12-31', '2024-01-01'), fact('net_income', 900, currency='USD')], gaps=[])
        output = analyze(data, 'CHF')
        self.assertEqual(len(output['rejected_facts']), 1)
        self.assertAlmostEqual(output['periods'][1]['operating_margin'], .2)
        self.assertAlmostEqual(output['periods'][1]['revenue_growth'], 100 / 90 - 1)
        self.assertNotIn('net_income', output['periods'][1]['metrics'])

if __name__ == '__main__':
    unittest.main()
