"""Auditable, dependency-free deterministic engines for Portfolio Intelligence.

These engines consume human-reviewed, source-linked JSON only. They do not call
LLMs, fetch market data, pick peers, create assumptions, or issue investment
instructions. Run as a CLI:

    python3 python/deterministic_engines.py dcf input.json
    python3 python/deterministic_engines.py comparables input.json
    python3 python/deterministic_engines.py risk input.json

The source of truth in production remains the TypeScript engines until a
separately approved service integration and cross-language parity gate exist.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from dataclasses import asdict, dataclass, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Literal, Mapping, Sequence


class EngineValidationError(ValueError):
    """Raised when an approved input would produce an unsafe or ambiguous result."""


ISO_CURRENCY_LENGTH = 3
TRADING_DAYS = 252


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EngineValidationError(message)


def finite(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise EngineValidationError(f"{name} must be numeric") from error
    if not math.isfinite(number):
        raise EngineValidationError(f"{name} must be finite")
    return number


def optional_finite(value: Any, name: str) -> float | None:
    return None if value is None else finite(value, name)


def currency(value: Any, name: str = "currency") -> str:
    result = str(value or "").strip().upper()
    require(len(result) == ISO_CURRENCY_LENGTH and result.isalpha(), f"{name} must be an ISO 4217 code")
    return result


def references(value: Any, name: str = "source_references") -> list[str]:
    require(isinstance(value, list) and value, f"{name} must contain at least one source reference")
    cleaned = [str(item).strip() for item in value]
    require(all(cleaned), f"{name} cannot contain an empty reference")
    return cleaned


def as_json(value: Any) -> Any:
    if is_dataclass(value):
        return {key: as_json(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: as_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [as_json(item) for item in value]
    return value


def percentile(values: Sequence[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower, upper = math.floor(position), math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def sample_std(values: Sequence[float]) -> float:
    require(len(values) >= 2, "at least two observations are required")
    return statistics.stdev(values)


def mean(values: Sequence[float]) -> float:
    require(bool(values), "at least one observation is required")
    return statistics.fmean(values)


# ---------------------------------------------------------------------------
# DCF — deterministic FCFF / FCFE calculator from human-confirmed inputs.
# ---------------------------------------------------------------------------


def deterministic_cost_of_capital(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Calculate a traceable WACC from supplied, approved market inputs.

    This deliberately accepts market values rather than deriving them from a
    share price. Valuing the equity to construct its own discount rate creates a
    circular, opaque dependency. The analyst supplies a dated capital structure
    and the engine exposes every arithmetic step.
    """
    unit_currency = currency(payload.get("currency"), "cost of capital currency")
    basis = str(payload.get("basis", "")).lower()
    require(basis in {"nominal", "real"}, "cost of capital basis must be nominal or real")
    risk_free = finite(payload.get("risk_free_rate"), "cost of capital risk_free_rate")
    equity_risk_premium = finite(payload.get("equity_risk_premium"), "equity_risk_premium")
    pre_tax_cost_of_debt = finite(payload.get("pre_tax_cost_of_debt"), "pre_tax_cost_of_debt")
    marginal_tax_rate = finite(payload.get("marginal_tax_rate"), "marginal_tax_rate")
    unlevered_beta = finite(payload.get("unlevered_beta"), "unlevered_beta")
    debt_market_value = finite(payload.get("debt_market_value"), "debt_market_value")
    equity_market_value = finite(payload.get("equity_market_value"), "equity_market_value")
    require(-0.05 <= risk_free < 1, "risk_free_rate must be between -5% and 100%")
    require(0 <= equity_risk_premium < 1, "equity_risk_premium must be between 0% and 100%")
    require(0 <= pre_tax_cost_of_debt < 1, "pre_tax_cost_of_debt must be between 0% and 100%")
    require(0 <= marginal_tax_rate <= 1, "marginal_tax_rate must be between 0% and 100%")
    require(unlevered_beta >= 0, "unlevered_beta cannot be negative")
    require(debt_market_value >= 0 and equity_market_value > 0,
            "debt_market_value must be non-negative and equity_market_value must be positive")
    country_risk_approach = str(payload.get("country_risk_approach", "")).lower()
    require(country_risk_approach in {"embedded_in_beta", "separate"},
            "country_risk_approach must be embedded_in_beta or separate")
    country_risk_premium = optional_finite(payload.get("country_risk_premium"), "country_risk_premium")
    if country_risk_approach == "embedded_in_beta":
        require(country_risk_premium in {None, 0.0},
                "country_risk_premium must be omitted or zero when it is embedded in beta")
        country_risk_premium = 0.0
    else:
        require(country_risk_premium is not None and country_risk_premium >= 0,
                "separate country risk requires a non-negative country_risk_premium")

    sources = references(payload.get("source_references"), "cost of capital source_references")
    capital = debt_market_value + equity_market_value
    debt_weight = debt_market_value / capital
    equity_weight = equity_market_value / capital
    debt_to_equity = debt_market_value / equity_market_value
    levered_beta = unlevered_beta * (1 + (1 - marginal_tax_rate) * debt_to_equity)
    cost_of_equity = risk_free + levered_beta * equity_risk_premium + country_risk_premium
    after_tax_cost_of_debt = pre_tax_cost_of_debt * (1 - marginal_tax_rate)
    wacc = cost_of_equity * equity_weight + after_tax_cost_of_debt * debt_weight
    require(0 < cost_of_equity < 1 and 0 < wacc < 1,
            "computed cost of equity and WACC must each be between 0% and 100%")
    return {
        "currency": unit_currency,
        "basis": basis,
        "country_risk_approach": country_risk_approach,
        "risk_free_rate": risk_free,
        "equity_risk_premium": equity_risk_premium,
        "country_risk_premium": country_risk_premium,
        "marginal_tax_rate": marginal_tax_rate,
        "unlevered_beta": unlevered_beta,
        "levered_beta": levered_beta,
        "debt_market_value": debt_market_value,
        "equity_market_value": equity_market_value,
        "debt_weight": debt_weight,
        "equity_weight": equity_weight,
        "pre_tax_cost_of_debt": pre_tax_cost_of_debt,
        "after_tax_cost_of_debt": after_tax_cost_of_debt,
        "cost_of_equity": cost_of_equity,
        "wacc": wacc,
        "source_references": sources,
        "methodology": "Bottom-up beta relevered to the supplied market-value capital structure; WACC uses after-tax debt cost.",
        "computed_at": now_iso(),
    }


@dataclass(frozen=True)
class DcfYear:
    year: int
    ebit: float | None = None
    net_income: float | None = None
    tax_rate: float | None = None
    depreciation_amortization: float = 0.0
    capex: float = 0.0
    delta_nwc: float = 0.0
    delta_net_debt: float = 0.0
    source_references: tuple[str, ...] = ()


def _dcf_year(row: Mapping[str, Any], method: str) -> DcfYear:
    year = int(finite(row.get("year"), "forecast year"))
    require(year >= 1, "forecast year must start at 1")
    refs = tuple(references(row.get("source_references"), f"forecast year {year} source_references"))
    tax = optional_finite(row.get("tax_rate"), f"forecast year {year} tax_rate")
    if method == "fcff":
        require(tax is not None, f"forecast year {year} FCFF requires tax_rate")
        require(0 <= tax <= 1, f"forecast year {year} tax_rate must be between 0 and 1")
        ebit = finite(row.get("ebit"), f"forecast year {year} EBIT")
        return DcfYear(year, ebit=ebit, tax_rate=tax,
                       depreciation_amortization=finite(row.get("depreciation_amortization"), f"forecast year {year} D&A"),
                       capex=finite(row.get("capex"), f"forecast year {year} capex"),
                       delta_nwc=finite(row.get("delta_nwc"), f"forecast year {year} delta_nwc"),
                       source_references=refs)
    net_income = finite(row.get("net_income"), f"forecast year {year} net_income")
    return DcfYear(year, net_income=net_income,
                   depreciation_amortization=finite(row.get("depreciation_amortization"), f"forecast year {year} D&A"),
                   capex=finite(row.get("capex"), f"forecast year {year} capex"),
                   delta_nwc=finite(row.get("delta_nwc"), f"forecast year {year} delta_nwc"),
                   delta_net_debt=finite(row.get("delta_net_debt"), f"forecast year {year} delta_net_debt"),
                   source_references=refs)


def deterministic_dcf(payload: Mapping[str, Any]) -> dict[str, Any]:
    require(bool(payload.get("human_confirmed")), "DCF requires human_confirmed true")
    approval_reference = str(payload.get("approval_reference", "")).strip()
    require(approval_reference, "DCF requires an approval_reference")
    method = str(payload.get("method", "")).lower()
    require(method in {"fcff", "fcfe"}, "DCF method must be fcff or fcfe")
    basis = str(payload.get("basis", "")).lower()
    require(basis in {"nominal", "real"}, "DCF basis must be nominal or real")
    unit_currency = currency(payload.get("currency"))
    discount_currency = currency(payload.get("discount_rate_currency"), "discount_rate_currency")
    require(unit_currency == discount_currency, "cash-flow currency and discount-rate currency must match")
    require(str(payload.get("discount_rate_basis", "")).lower() == basis,
            "cash-flow inflation basis and discount-rate basis must match")
    required_kind = "wacc" if method == "fcff" else "cost_of_equity"
    require(str(payload.get("discount_rate_kind", "")).lower() == required_kind,
            f"{method.upper()} must discount at {required_kind}")

    discount_rate = finite(payload.get("discount_rate"), "discount_rate")
    terminal_growth = finite(payload.get("terminal_growth_rate"), "terminal_growth_rate")
    risk_free = finite(payload.get("risk_free_rate"), "risk_free_rate")
    terminal_return_field = "terminal_roic" if method == "fcff" else "terminal_return_on_equity"
    terminal_return = finite(payload.get(terminal_return_field), terminal_return_field)
    require(0 < discount_rate < 1, "discount_rate must be between 0 and 1")
    require(-0.05 <= terminal_growth <= 0.05, "terminal_growth_rate must be between -5% and 5%")
    require(discount_rate > terminal_growth, "discount_rate must exceed terminal_growth_rate")
    require(terminal_growth <= risk_free, "terminal_growth_rate cannot exceed the same-currency risk-free rate")
    require(terminal_return > 0, f"{terminal_return_field} must be positive")
    if terminal_return > discount_rate:
        require(bool(str(payload.get("perpetuity_excess_return_rationale", "")).strip()),
                f"{terminal_return_field} above discount rate requires perpetuity_excess_return_rationale")

    cost_of_capital = None
    supplied_components = payload.get("discount_rate_components")
    if supplied_components is not None:
        require(isinstance(supplied_components, Mapping), "discount_rate_components must be an object")
        cost_of_capital = deterministic_cost_of_capital(supplied_components)
        require(cost_of_capital["currency"] == unit_currency,
                "discount_rate_components currency must match DCF currency")
        require(cost_of_capital["basis"] == basis,
                "discount_rate_components basis must match DCF basis")
        expected_rate = cost_of_capital["wacc"] if method == "fcff" else cost_of_capital["cost_of_equity"]
        require(math.isclose(discount_rate, expected_rate, abs_tol=0.0001),
                f"approved discount_rate must match calculated {required_kind} within one basis point")
        require(math.isclose(risk_free, cost_of_capital["risk_free_rate"], abs_tol=0.000001),
                "DCF risk_free_rate must match discount_rate_components risk_free_rate")

    rows = payload.get("forecast")
    require(isinstance(rows, list) and 1 <= len(rows) <= 10, "forecast must contain 1 to 10 annual periods")
    years = [_dcf_year(row, method) for row in rows if isinstance(row, Mapping)]
    require(len(years) == len(rows), "every forecast period must be an object")
    require([row.year for row in years] == list(range(1, len(years) + 1)), "forecast years must be consecutive from 1")
    common_sources = references(payload.get("source_references"))
    net_debt = finite(payload.get("net_debt"), "net_debt")
    minority_interest = finite(payload.get("minority_interest"), "minority_interest")
    preferred_stock = finite(payload.get("preferred_stock"), "preferred_stock")
    non_operating_assets = finite(payload.get("non_operating_assets"), "non_operating_assets")
    diluted_shares = finite(payload.get("diluted_shares"), "diluted_shares")
    require(diluted_shares > 0, "diluted_shares must be positive")
    require(str(payload.get("timing_convention", "")).lower() == "year_end", "only year_end timing is supported")

    projected: list[dict[str, Any]] = []
    pv_explicit = 0.0
    ending_cash_flow = 0.0
    for row in years:
        if method == "fcff":
            assert row.ebit is not None and row.tax_rate is not None
            nopat = row.ebit * (1 - row.tax_rate)
            cash_flow = nopat + row.depreciation_amortization - row.capex - row.delta_nwc
            components = {"ebit": row.ebit, "tax_rate": row.tax_rate, "nopat": nopat}
        else:
            assert row.net_income is not None
            cash_flow = row.net_income + row.depreciation_amortization - row.capex - row.delta_nwc + row.delta_net_debt
            components = {"net_income": row.net_income, "delta_net_debt": row.delta_net_debt}
        factor = 1 / ((1 + discount_rate) ** row.year)
        present_value = cash_flow * factor
        pv_explicit += present_value
        ending_cash_flow = cash_flow
        projected.append({"year": row.year, **components, "depreciation_amortization": row.depreciation_amortization,
                          "capex": row.capex, "delta_nwc": row.delta_nwc, "cash_flow": cash_flow,
                          "discount_factor": factor, "present_value": present_value,
                          "source_references": list(row.source_references)})

    terminal_reinvestment_rate = terminal_growth / terminal_return
    require(terminal_reinvestment_rate < 1, "terminal reinvestment rate must be below 100%")
    terminal_value = ending_cash_flow * (1 + terminal_growth) / (discount_rate - terminal_growth)
    terminal_pv = terminal_value / ((1 + discount_rate) ** len(years))
    discounted_value = pv_explicit + terminal_pv
    if method == "fcff":
        enterprise_value: float | None = discounted_value
        equity_value = enterprise_value - net_debt - minority_interest - preferred_stock + non_operating_assets
    else:
        enterprise_value = None
        equity_value = discounted_value
    fair_value_per_share = equity_value / diluted_shares

    sensitivity: list[dict[str, float | None]] = []
    for rate_delta in (-0.02, -0.01, 0.0, 0.01, 0.02):
        for growth_delta in (-0.01, -0.005, 0.0, 0.005, 0.01):
            rate, growth = discount_rate + rate_delta, terminal_growth + growth_delta
            if rate <= growth or rate <= 0:
                value: float | None = None
            else:
                terminal = ending_cash_flow * (1 + growth) / (rate - growth)
                ev = sum(item["cash_flow"] / ((1 + rate) ** int(item["year"])) for item in projected) + terminal / ((1 + rate) ** len(years))
                eq = ev - net_debt - minority_interest - preferred_stock + non_operating_assets if method == "fcff" else ev
                value = eq / diluted_shares
            sensitivity.append({"discount_rate": rate, "terminal_growth_rate": growth, "fair_value_per_share": value})

    terminal_share = terminal_pv / discounted_value if discounted_value else None
    caveats = [
        "This is a deterministic scenario calculation, not a market-price prediction or trade instruction.",
            f"Terminal value is conditional on terminal growth, {terminal_return_field}, and the discount rate.",
        "All source references and assumptions require human approval before use.",
    ]
    if terminal_share is not None and terminal_share > 0.75:
        caveats.append("More than 75% of discounted value comes from terminal value; the result is highly sensitive to perpetuity assumptions.")
    return {"method": method, "currency": unit_currency, "basis": basis, "timing_convention": "year_end",
            "human_confirmed": True, "approval_reference": approval_reference,
            "discount_rate": discount_rate, "terminal_growth_rate": terminal_growth,
            terminal_return_field: terminal_return, "terminal_reinvestment_rate": terminal_reinvestment_rate, "forecast": projected,
            "terminal_value": terminal_value, "terminal_present_value": terminal_pv,
            "discounted_value": discounted_value, "enterprise_value": enterprise_value, "equity_value": equity_value,
            "fair_value_per_share": fair_value_per_share, "terminal_value_share_of_discounted_value": terminal_share,
            "sensitivity": sensitivity, "source_references": common_sources, "caveats": caveats,
            "discount_rate_components": cost_of_capital,
            "methodology": f"{method.upper()} discounted at {required_kind}; year-end timing; Gordon-growth terminal value.",
            "computed_at": now_iso()}


# ---------------------------------------------------------------------------
# Comparable companies — peer review stays human; math is deterministic.
# ---------------------------------------------------------------------------


MULTIPLES = {
    "ev_ltm_revenue": ("EV / LTM Revenue", "ev", "ltm_revenue"),
    "ev_ntm_revenue": ("EV / NTM Revenue", "ev", "ntm_revenue"),
    "ev_ltm_ebitda": ("EV / LTM EBITDA", "ev", "ltm_ebitda"),
    "ev_ntm_ebitda": ("EV / NTM EBITDA", "ev", "ntm_ebitda"),
    "pe_ltm": ("P / E LTM", "equity", "ltm_net_income"),
    "pe_ntm": ("P / E NTM", "equity", "ntm_net_income"),
}


def safe_ratio(numerator: float | None, denominator: float | None) -> float | None:
    return None if numerator is None or denominator is None or denominator <= 0 else numerator / denominator


def statistics_payload(values: Iterable[float | None]) -> dict[str, float | int | None]:
    actual = sorted(value for value in values if value is not None and math.isfinite(value))
    return {"count": len(actual), "mean": mean(actual) if actual else None, "median": percentile(actual, 0.5),
            "percentile25": percentile(actual, 0.25), "percentile75": percentile(actual, 0.75)}


def iqr_outlier(value: float | None, stats: Mapping[str, Any]) -> bool:
    first, third = stats.get("percentile25"), stats.get("percentile75")
    if value is None or first is None or third is None or third == first:
        return False
    return value < first - 1.5 * (third - first) or value > third + 1.5 * (third - first)


def deterministic_comparables(payload: Mapping[str, Any]) -> dict[str, Any]:
    require(bool(payload.get("human_confirmed")), "comparables require human_confirmed true")
    approval_reference = str(payload.get("approval_reference", "")).strip()
    require(approval_reference, "comparables require an approval_reference")
    target = payload.get("target")
    peers = payload.get("peers")
    require(isinstance(target, Mapping), "target must be an object")
    require(isinstance(peers, list) and 6 <= len(peers) <= 10, "comparables require 6 to 10 peers")
    target_currency = currency(target.get("currency"), "target currency")
    target_name = str(target.get("company_name", "")).strip()
    require(target_name, "target company_name is required")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for peer in peers:
        require(isinstance(peer, Mapping), "every peer must be an object")
        ticker = str(peer.get("ticker", "")).upper().strip()
        require(ticker and ticker not in seen, "peer tickers must be unique and non-empty")
        seen.add(ticker)
        require(bool(peer.get("human_reviewed")), f"peer {ticker} must be human_reviewed")
        require(str(peer.get("selection_rationale", "")).strip(), f"peer {ticker} requires selection_rationale")
        peer_currency = currency(peer.get("currency"), f"peer {ticker} currency")
        require(peer_currency == target_currency, f"peer {ticker} currency differs from target; convert outside this engine with an approved FX input")
        source_refs = references(peer.get("source_references"), f"peer {ticker} source_references")
        market_cap = finite(peer.get("market_capitalization"), f"peer {ticker} market_capitalization")
        net_debt = finite(peer.get("net_debt"), f"peer {ticker} net_debt")
        require(market_cap > 0, f"peer {ticker} market_capitalization must be positive")
        minority = finite(peer.get("minority_interest", 0), f"peer {ticker} minority_interest")
        preferred = finite(peer.get("preferred_stock", 0), f"peer {ticker} preferred_stock")
        ev = market_cap + net_debt + minority + preferred
        record: dict[str, Any] = {"company_name": str(peer.get("company_name", "")).strip(), "ticker": ticker,
                                  "currency": peer_currency, "enterprise_value": ev, "market_capitalization": market_cap,
                                  "net_debt": net_debt, "minority_interest": minority, "preferred_stock": preferred,
                                  "source_references": source_refs, "selection_rationale": str(peer["selection_rationale"]),
                                  "outlier_multiples": []}
        require(record["company_name"], f"peer {ticker} company_name is required")
        for field in ("ltm_revenue", "ntm_revenue", "ltm_ebitda", "ntm_ebitda", "ltm_net_income", "ntm_net_income", "gross_profit", "operating_income", "total_equity", "total_debt", "cash_and_equivalents", "interest_expense", "income_tax_expense", "pre_tax_income"):
            record[field] = optional_finite(peer.get(field), f"peer {ticker} {field}")
        for key, (_, numerator_kind, denominator) in MULTIPLES.items():
            record[key] = safe_ratio(ev if numerator_kind == "ev" else market_cap, record[denominator])
        record["gross_margin"] = safe_ratio(record["gross_profit"], record["ltm_revenue"])
        record["operating_margin"] = safe_ratio(record["operating_income"], record["ltm_revenue"])
        record["ebitda_margin"] = safe_ratio(record["ltm_ebitda"], record["ltm_revenue"])
        record["net_margin"] = safe_ratio(record["ltm_net_income"], record["ltm_revenue"])
        record["return_on_equity"] = safe_ratio(record["ltm_net_income"], record["total_equity"])
        record["net_debt_ebitda"] = safe_ratio(net_debt, record["ltm_ebitda"])
        record["debt_to_equity"] = safe_ratio(record["total_debt"], record["total_equity"])
        record["interest_coverage"] = safe_ratio(record["operating_income"], record["interest_expense"])
        invested_capital = None if None in (record["total_debt"], record["total_equity"], record["cash_and_equivalents"]) else record["total_debt"] + record["total_equity"] - record["cash_and_equivalents"]
        tax_rate = safe_ratio(record["income_tax_expense"], record["pre_tax_income"])
        record["roic"] = None if record["operating_income"] is None or tax_rate is None or invested_capital is None or invested_capital <= 0 or not 0 <= tax_rate <= 1 else record["operating_income"] * (1 - tax_rate) / invested_capital
        normalized.append(record)

    stats = {key: statistics_payload(peer[key] for peer in normalized) for key in MULTIPLES}
    for peer in normalized:
        peer["outlier_multiples"] = [MULTIPLES[key][0] for key in MULTIPLES if iqr_outlier(peer[key], stats[key])]
    implied: list[dict[str, Any]] = []
    for key, (label, numerator_kind, target_field) in MULTIPLES.items():
        base = optional_finite(target.get(target_field), f"target {target_field}")
        if base is None or base <= 0:
            continue
        for statistic_name in ("median", "mean"):
            multiple = stats[key][statistic_name]
            if multiple is None:
                continue
            enterprise = multiple * base if numerator_kind == "ev" else None
            equity = (enterprise - finite(target.get("net_debt", 0), "target net_debt")) if enterprise is not None else multiple * base
            shares = optional_finite(target.get("diluted_shares"), "target diluted_shares")
            implied.append({"multiple": label, "statistic": statistic_name.title(), "multiple_value": multiple,
                            "implied_enterprise_value": enterprise, "implied_equity_value": equity,
                            "implied_value_per_share": None if shares is None or shares <= 0 else equity / shares})
    require(bool(implied), "no positive target denominator is available for implied valuation")
    return {"method": "comparable_companies", "currency": target_currency,
            "human_confirmed": True, "approval_reference": approval_reference, "target": dict(target), "peers": normalized,
            "statistics": stats, "implied_valuations": implied,
            "methodology": "Human-reviewed peers; deterministic EV, trading multiples, summary statistics, IQR flags, and implied-value scenarios.",
            "caveats": ["Peer selection is a human judgment; the engine does not certify comparability.",
                        "IQR flags are review prompts and never remove a peer automatically.",
                        "Implied values are conditional scenarios, not target prices or trade instructions."],
            "computed_at": now_iso()}


# ---------------------------------------------------------------------------
# Risk — price-series risk only. No accounting normalization enters the result.
# ---------------------------------------------------------------------------


def _prices(rows: Any, name: str) -> tuple[str, list[tuple[str, float]]]:
    require(isinstance(rows, list) and len(rows) >= 31, f"{name} requires at least 31 price observations")
    parsed: list[tuple[str, float]] = []
    for row in rows:
        require(isinstance(row, Mapping), f"{name} observations must be objects")
        date = str(row.get("date", ""))
        try:
            datetime.fromisoformat(date.replace("Z", "+00:00"))
        except ValueError as error:
            raise EngineValidationError(f"{name} contains invalid ISO date {date!r}") from error
        price = finite(row.get("close"), f"{name} close")
        require(price > 0, f"{name} close must be positive")
        parsed.append((date, price))
    parsed.sort(key=lambda item: item[0])
    require(len({date for date, _ in parsed}) == len(parsed), f"{name} contains duplicate dates")
    return parsed[-1][0], parsed


def returns_from_prices(prices: Sequence[tuple[str, float]]) -> dict[str, float]:
    return {prices[index][0]: prices[index][1] / prices[index - 1][1] - 1 for index in range(1, len(prices))}


def historical_var(returns: Sequence[float], confidence: float) -> float:
    return max(0.0, -(percentile(sorted(returns), 1 - confidence) or 0.0))


def deterministic_risk(payload: Mapping[str, Any]) -> dict[str, Any]:
    unit_currency = currency(payload.get("currency"))
    confidence = finite(payload.get("confidence_level", 0.95), "confidence_level")
    horizon = int(finite(payload.get("horizon_days", 1), "horizon_days"))
    require(0 < confidence < 1 and horizon >= 1, "confidence_level must be in (0,1) and horizon_days must be positive")
    sources = references(payload.get("source_references"))
    data_as_of, series = _prices(payload.get("prices"), "prices")
    returns_by_date = returns_from_prices(series)
    returns = list(returns_by_date.values())
    volatility = sample_std(returns) * math.sqrt(TRADING_DAYS)
    running_peak, max_drawdown = series[0][1], 0.0
    for _, close in series:
        running_peak = max(running_peak, close)
        max_drawdown = max(max_drawdown, (running_peak - close) / running_peak)
    hist_var = historical_var(returns, confidence) * math.sqrt(horizon)
    z = statistics.NormalDist().inv_cdf(1 - confidence)
    parametric_var = max(0.0, -(mean(returns) + z * sample_std(returns))) * math.sqrt(horizon)
    tail = [value for value in returns if value <= (percentile(returns, 1 - confidence) or 0.0)]
    expected_shortfall = max(0.0, -mean(tail)) * math.sqrt(horizon) if tail else None
    metrics: list[dict[str, Any]] = [
        {"name": "Volatility", "value": volatility, "methodology": f"Sample standard deviation of {len(returns)} daily returns annualized by sqrt({TRADING_DAYS})", "caveat": None if len(returns) >= 30 else "Short sample."},
        {"name": "MaxDrawdown", "value": max_drawdown, "methodology": f"Largest peak-to-trough decline across {len(series)} supplied closing prices", "caveat": None},
        {"name": f"VaR_{confidence * 100:.0f}_{horizon}d_Historical", "value": hist_var, "methodology": "Empirical lower-tail return quantile with linear interpolation; sqrt-time scaling for horizons above one day", "caveat": None if (1 - confidence) * len(returns) >= 5 else "Too few tail observations for a stable historical VaR estimate."},
        {"name": f"VaR_{confidence * 100:.0f}_{horizon}d_Parametric", "value": parametric_var, "methodology": "Gaussian VaR from sample mean and standard deviation; sqrt-time scaling for horizons above one day", "caveat": "Parametric VaR assumes normal returns and can understate tail risk."},
    ]
    if expected_shortfall is not None:
        metrics.append({"name": f"ExpectedShortfall_{confidence * 100:.0f}_{horizon}d_Historical", "value": expected_shortfall, "methodology": "Average loss in the empirical tail beyond historical VaR; sqrt-time scaling for horizons above one day", "caveat": None if len(tail) >= 5 else "Too few tail observations for a stable expected-shortfall estimate."})
    rf = optional_finite(payload.get("risk_free_annual"), "risk_free_annual")
    if rf is not None:
        require(currency(payload.get("risk_free_currency"), "risk_free_currency") == unit_currency, "risk-free rate currency must match return currency")
        sd = sample_std(returns)
        require(sd > 0, "Sharpe is undefined for zero-volatility returns")
        periodic_rf = (1 + rf) ** (1 / TRADING_DAYS) - 1
        metrics.append({"name": "Sharpe", "value": (mean(returns) - periodic_rf) / sd * math.sqrt(TRADING_DAYS), "methodology": "Annualized arithmetic Sharpe using same-currency annual risk-free rate", "caveat": None if len(returns) >= 60 else "Sharpe has wide standard error on short samples."})
    benchmark = payload.get("benchmark_prices")
    if benchmark is not None:
        benchmark_currency = currency(payload.get("benchmark_currency"), "benchmark_currency")
        require(benchmark_currency == unit_currency, "benchmark and security currencies must match")
        _, benchmark_series = _prices(benchmark, "benchmark_prices")
        benchmark_returns = returns_from_prices(benchmark_series)
        dates = sorted(set(returns_by_date).intersection(benchmark_returns))
        require(len(dates) >= 30, "beta/correlation require at least 30 aligned return observations")
        asset = [returns_by_date[date] for date in dates]
        market = [benchmark_returns[date] for date in dates]
        market_mean = mean(market)
        variance = sum((value - market_mean) ** 2 for value in market) / (len(market) - 1)
        require(variance > 0, "benchmark variance is zero")
        covariance = sum((asset[index] - mean(asset)) * (market[index] - market_mean) for index in range(len(asset))) / (len(asset) - 1)
        correlation = covariance / (sample_std(asset) * sample_std(market))
        metrics.extend([
            {"name": "Beta", "value": covariance / variance, "methodology": f"OLS slope of {len(dates)} aligned same-currency daily returns", "caveat": "Beta is backward-looking and sample-dependent."},
            {"name": "Correlation", "value": correlation, "methodology": f"Pearson correlation of {len(dates)} aligned same-currency daily returns", "caveat": "Correlation is backward-looking and unstable in stressed markets."},
        ])
    for metric in metrics:
        metric.update({"currency": unit_currency, "data_as_of": data_as_of, "lookback_days": len(returns), "source_references": sources, "computed_at": now_iso()})
    return {"method": "price_series_risk", "currency": unit_currency, "data_as_of": data_as_of, "metrics": metrics,
            "methodology": "Point-in-time risk from supplied price observations only; no accounting normalization, forecast, or implied valuation is used.",
            "caveats": ["Risk metrics are backward-looking and do not predict future loss.", "Historical and parametric VaR rely on assumptions that may fail in stressed or illiquid markets."],
            "computed_at": now_iso()}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Portfolio Intelligence deterministic Python engines")
    parser.add_argument("engine", choices=("dcf", "comparables", "risk"))
    parser.add_argument("input", type=Path, help="Human-reviewed JSON input")
    args = parser.parse_args(argv)
    try:
        payload = json.loads(args.input.read_text(encoding="utf-8"))
        require(isinstance(payload, Mapping), "input JSON must be an object")
        result = {"dcf": deterministic_dcf, "comparables": deterministic_comparables, "risk": deterministic_risk}[args.engine](payload)
        json.dump(as_json(result), sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return 0
    except (OSError, json.JSONDecodeError, EngineValidationError) as error:
        print(f"engine_error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
