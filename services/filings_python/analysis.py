"""Deterministic calculations from extracted, explicitly sourced annual facts."""
from __future__ import annotations
import math
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

METRICS = {
    'revenue', 'gross_profit', 'operating_income', 'net_income',
    'operating_cash_flow', 'capital_expenditure', 'cash_and_equivalents',
    'total_debt', 'total_equity', 'shares_outstanding',
}

class ExtractedFact(BaseModel):
    model_config = ConfigDict(extra='forbid')
    metric: str
    value: float
    currency: str
    unit_multiplier: int
    fiscal_period_end: str
    fiscal_period_start: str | None
    page: int
    quote: str

class Extraction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    issuer_name: str
    facts: list[ExtractedFact]
    gaps: list[str]


def analyze(extraction: Extraction, expected_currency: str) -> dict:
    accepted = []
    rejected = []
    for fact in extraction.facts[:150]:
        valid_date = pd.to_datetime(fact.fiscal_period_end, format='%Y-%m-%d', errors='coerce')
        if (fact.metric not in METRICS or fact.currency != expected_currency or fact.unit_multiplier not in (1, 1_000, 1_000_000)
                or fact.page < 1 or not fact.quote.strip() or pd.isna(valid_date)
                or not math.isfinite(fact.value) or abs(fact.value * fact.unit_multiplier) > 9e15):
            rejected.append({'metric': fact.metric, 'reason': 'Unsupported metric, currency, unit, date, page, quote, or amount'})
            continue
        if fact.fiscal_period_start:
            start = pd.to_datetime(fact.fiscal_period_start, format='%Y-%m-%d', errors='coerce')
            days = (valid_date - start).days if not pd.isna(start) else -1
            if not 330 <= days <= 380:
                rejected.append({'metric': fact.metric, 'reason': 'Flow is not an annual duration'})
                continue
        elif fact.metric not in {'cash_and_equivalents', 'total_debt', 'total_equity', 'shares_outstanding'}:
            rejected.append({'metric': fact.metric, 'reason': 'Flow needs a fiscal start date'})
            continue
        accepted.append({**fact.model_dump(), 'normalized_value': fact.value * fact.unit_multiplier})
    frame = pd.DataFrame(accepted)
    periods = []
    if not frame.empty:
        for end, group in frame.groupby('fiscal_period_end', sort=True):
            metrics = {}
            conflicts = []
            for metric, rows in group.groupby('metric'):
                values = rows['normalized_value'].drop_duplicates().tolist()
                if len(values) == 1:
                    metrics[metric] = values[0]
                else:
                    conflicts.append(metric)
            if 'operating_cash_flow' in metrics and 'capital_expenditure' in metrics:
                metrics['free_cash_flow'] = metrics['operating_cash_flow'] - abs(metrics['capital_expenditure'])
            revenue = metrics.get('revenue')
            ratio = lambda metric: metrics[metric] / revenue if revenue and revenue > 0 and metric in metrics else None
            periods.append({'period_end': end, 'metrics': metrics, 'operating_margin': ratio('operating_income'),
                            'net_margin': ratio('net_income'), 'fcf_to_revenue': ratio('free_cash_flow'),
                            'conflicting_metrics': conflicts})
        for index, period in enumerate(periods):
            prior = periods[index - 1] if index else None
            current_revenue = period['metrics'].get('revenue')
            prior_revenue = prior['metrics'].get('revenue') if prior else None
            consecutive = prior and int(period['period_end'][:4]) - int(prior['period_end'][:4]) == 1
            period['revenue_growth'] = current_revenue / prior_revenue - 1 if consecutive and current_revenue is not None and prior_revenue and prior_revenue > 0 else None
    return {'accepted_facts': accepted, 'rejected_facts': rejected, 'periods': periods,
            'gaps': extraction.gaps, 'review_required': True}
