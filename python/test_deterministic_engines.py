"""Golden-path and safety-boundary tests for the reference engines."""

from __future__ import annotations

from datetime import date, timedelta
import unittest

from python.deterministic_engines import (
    EngineValidationError,
    deterministic_comparables,
    deterministic_dcf,
    deterministic_risk,
)


DCF_COMPONENTS = {
    "currency": "USD",
    "basis": "nominal",
    "risk_free_rate": 0.03,
    "equity_risk_premium": 0.05,
    "pre_tax_cost_of_debt": 0.06,
    "marginal_tax_rate": 0.25,
    "unlevered_beta": 0.8,
    "debt_market_value": 50,
    "equity_market_value": 150,
    "country_risk_approach": "embedded_in_beta",
    "source_references": ["Approved market-input pack, 2026-09-17"],
}


def dcf_input(**overrides):
    payload = {
        "human_confirmed": True,
        "approval_reference": "decision-log/dcf-approval-001",
        "method": "fcff",
        "currency": "USD",
        "basis": "nominal",
        "discount_rate_currency": "USD",
        "discount_rate_basis": "nominal",
        "discount_rate_kind": "wacc",
        "discount_rate": 0.07125,
        "risk_free_rate": 0.03,
        "terminal_growth_rate": 0.02,
        "terminal_roic": 0.07125,
        "timing_convention": "year_end",
        "net_debt": 40,
        "minority_interest": 0,
        "preferred_stock": 0,
        "non_operating_assets": 5,
        "diluted_shares": 20,
        "source_references": ["Approved DCF-assumption pack, 2026-09-17"],
        "discount_rate_components": DCF_COMPONENTS,
        "forecast": [
            {"year": 1, "ebit": 20, "tax_rate": 0.25, "depreciation_amortization": 4, "capex": 5, "delta_nwc": 2, "source_references": ["Year 1 approved drivers"]},
            {"year": 2, "ebit": 23, "tax_rate": 0.25, "depreciation_amortization": 4, "capex": 5, "delta_nwc": 2, "source_references": ["Year 2 approved drivers"]},
            {"year": 3, "ebit": 26, "tax_rate": 0.25, "depreciation_amortization": 4, "capex": 6, "delta_nwc": 2, "source_references": ["Year 3 approved drivers"]},
        ],
    }
    payload.update(overrides)
    return payload


class DcfEngineTest(unittest.TestCase):
    def test_fcff_calculation_discloses_component_bridge(self):
        result = deterministic_dcf(dcf_input())

        self.assertEqual(result["method"], "fcff")
        self.assertTrue(result["human_confirmed"])
        self.assertAlmostEqual(result["discount_rate_components"]["levered_beta"], 1.0)
        self.assertAlmostEqual(result["discount_rate_components"]["wacc"], 0.07125)
        self.assertGreater(result["enterprise_value"], 0)
        self.assertGreater(result["fair_value_per_share"], 0)
        self.assertEqual(len(result["sensitivity"]), 25)

    def test_dcf_refuses_terminal_growth_at_or_above_discount_rate(self):
        invalid = dcf_input(discount_rate=0.04, terminal_growth_rate=0.05, discount_rate_components=None)
        with self.assertRaisesRegex(EngineValidationError, "discount_rate must exceed"):
            deterministic_dcf(invalid)

    def test_dcf_refuses_unconfirmed_assumptions(self):
        invalid = dcf_input(human_confirmed=False)
        with self.assertRaisesRegex(EngineValidationError, "human_confirmed"):
            deterministic_dcf(invalid)


def peer(index: int) -> dict:
    return {
        "company_name": f"Peer {index}",
        "ticker": f"P{index}",
        "currency": "USD",
        "human_reviewed": True,
        "selection_rationale": "Reviewed common business model, scale, and growth profile.",
        "source_references": [f"Peer {index} approved evidence pack"],
        "market_capitalization": 200 + index * 10,
        "net_debt": 45 + index,
        "ltm_revenue": 100 + index * 5,
        "ntm_revenue": 108 + index * 5,
        "ltm_ebitda": 20 + index,
        "ntm_ebitda": 22 + index,
        "ltm_net_income": 10 + index,
        "ntm_net_income": 11 + index,
        "gross_profit": 45 + index,
        "operating_income": 16 + index,
        "total_equity": 120 + index,
        "total_debt": 70 + index,
        "cash_and_equivalents": 25,
        "interest_expense": 4,
        "income_tax_expense": 5,
        "pre_tax_income": 20,
    }


class ComparableEngineTest(unittest.TestCase):
    def test_peer_multiples_include_statistics_and_implied_values(self):
        result = deterministic_comparables({
            "human_confirmed": True,
            "approval_reference": "decision-log/comps-approval-001",
            "target": {
                "company_name": "Target Co",
                "currency": "USD",
                "ltm_revenue": 140,
                "ntm_revenue": 150,
                "ltm_ebitda": 30,
                "ntm_ebitda": 33,
                "ltm_net_income": 17,
                "ntm_net_income": 19,
                "net_debt": 30,
                "diluted_shares": 25,
            },
            "peers": [peer(index) for index in range(1, 7)],
        })

        self.assertEqual(result["statistics"]["ev_ltm_revenue"]["count"], 6)
        self.assertEqual(len(result["peers"]), 6)
        self.assertGreaterEqual(len(result["implied_valuations"]), 6)
        self.assertTrue(result["human_confirmed"])

    def test_peer_engine_refuses_cross_currency_input(self):
        peers = [peer(index) for index in range(1, 7)]
        peers[0]["currency"] = "EUR"
        with self.assertRaisesRegex(EngineValidationError, "currency differs"):
            deterministic_comparables({
                "human_confirmed": True,
                "approval_reference": "decision-log/comps-approval-002",
                "target": {"company_name": "Target Co", "currency": "USD", "ltm_revenue": 140},
                "peers": peers,
            })


class RiskEngineTest(unittest.TestCase):
    def test_price_series_metrics_are_reported_with_methodology(self):
        start = date(2026, 1, 1)
        prices = [
            {"date": (start + timedelta(days=index)).isoformat(), "close": 100 + index * 0.75 + (index % 3) * 0.4}
            for index in range(35)
        ]
        result = deterministic_risk({
            "currency": "USD",
            "source_references": ["Approved price history"],
            "prices": prices,
            "risk_free_annual": 0.03,
            "risk_free_currency": "USD",
        })

        names = {metric["name"] for metric in result["metrics"]}
        self.assertIn("Volatility", names)
        self.assertIn("MaxDrawdown", names)
        self.assertIn("Sharpe", names)
        self.assertTrue(all(metric["methodology"] for metric in result["metrics"]))

    def test_risk_refuses_mixed_currency_benchmark(self):
        start = date(2026, 1, 1)
        prices = [{"date": (start + timedelta(days=index)).isoformat(), "close": 100 + index} for index in range(35)]
        with self.assertRaisesRegex(EngineValidationError, "currencies must match"):
            deterministic_risk({
                "currency": "USD",
                "source_references": ["Approved price history"],
                "prices": prices,
                "benchmark_currency": "EUR",
                "benchmark_prices": prices,
            })


if __name__ == "__main__":
    unittest.main()
