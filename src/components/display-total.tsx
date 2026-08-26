'use client';

/**
 * DisplayTotal — the one cosmetic cross-currency figure in the whole system
 * (Section 3.1 "Disclaimer persistence"). The disclaimer is rendered
 * unconditionally, every time, next to the number — never behind a toggle,
 * never collapsible. If this component is on screen, so is the sentence
 * explaining that the number is display-only.
 */
export interface DisplayTotalData {
  displayCurrency: string;
  convertedTotal: number;
  rateDate: string;
  disclaimer: string;
}

export function DisplayTotal({ data }: { data: DisplayTotalData | null }) {
  if (!data) return null;
  return (
    <div className="card display-total">
      <h2>Display total (cosmetic)</h2>
      <div className="big">
        {data.convertedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        <span className="cur">{data.displayCurrency}</span>
      </div>
      <p className="caveat">{data.disclaimer}</p>
    </div>
  );
}
