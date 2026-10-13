/** Indicative (non-binding) budget estimation from rate cards stored in the database. */

export interface BudgetRate {
  categorySlug: string;
  categoryName: string;
  unit: 'PER_GUEST' | 'FLAT' | 'PER_50_GUESTS';
  lowPaise: number;
  highPaise: number;
  foodPreference?: string | null;
}

export interface BudgetLine {
  categorySlug: string;
  categoryName: string;
  lowPaise: number;
  highPaise: number;
  basis: string;
}

export interface BudgetEstimate {
  lines: BudgetLine[];
  lowPaise: number;
  highPaise: number;
  budgetPaise: number | null;
  /** 'under' = budget below low estimate, 'tight' = between low and high, 'ok' = at or above high */
  fit: 'under' | 'tight' | 'ok' | null;
  warnings: string[];
  disclaimer: string;
}

function unitMultiplier(unit: BudgetRate['unit'], guests: number): number {
  if (unit === 'PER_GUEST') return guests;
  if (unit === 'PER_50_GUESTS') return Math.max(1, Math.ceil(guests / 50));
  return 1;
}

function basisText(unit: BudgetRate['unit'], guests: number): string {
  if (unit === 'PER_GUEST') return `${guests} guests × per-guest rate`;
  if (unit === 'PER_50_GUESTS') return `${Math.max(1, Math.ceil(guests / 50))} × per-50-guest rate`;
  return 'flat rate';
}

export function estimateBudget(
  rates: BudgetRate[],
  opts: { guestCount: number; categorySlugs: string[]; foodPreference?: string; budgetPaise?: number | null },
): BudgetEstimate {
  const warnings: string[] = [];
  const lines: BudgetLine[] = [];
  for (const slug of opts.categorySlugs) {
    const candidates = rates.filter((r) => r.categorySlug === slug);
    if (candidates.length === 0) {
      warnings.push(`No rate card yet for "${slug}" — ask vendors for a quote.`);
      continue;
    }
    const rate =
      candidates.find((r) => r.foodPreference && r.foodPreference === opts.foodPreference) ??
      candidates.find((r) => !r.foodPreference) ??
      candidates[0];
    const m = unitMultiplier(rate.unit, opts.guestCount);
    lines.push({
      categorySlug: slug,
      categoryName: rate.categoryName,
      lowPaise: rate.lowPaise * m,
      highPaise: rate.highPaise * m,
      basis: basisText(rate.unit, opts.guestCount),
    });
  }
  const lowPaise = lines.reduce((s, l) => s + l.lowPaise, 0);
  const highPaise = lines.reduce((s, l) => s + l.highPaise, 0);
  const budgetPaise = opts.budgetPaise ?? null;
  let fit: BudgetEstimate['fit'] = null;
  if (budgetPaise != null && lines.length > 0) {
    fit = budgetPaise < lowPaise ? 'under' : budgetPaise < highPaise ? 'tight' : 'ok';
    if (fit === 'under') warnings.push('Your budget is below the typical range for the services selected. Consider fewer services or guests.');
    if (fit === 'tight') warnings.push('Your budget is within range but leaves little room for add-ons.');
  }
  return {
    lines,
    lowPaise,
    highPaise,
    budgetPaise,
    fit,
    warnings,
    disclaimer: 'Indicative only, based on typical Greater Noida rates. Final prices come from vendor quotes.',
  };
}
