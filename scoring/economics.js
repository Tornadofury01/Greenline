// DOLLAR ESTIMATES: display only. These numbers never change a score or a ranking.
//
// Gross revenue (before costs, NOT profit) comes from the field's real USDA NASS data, field.market.recent[]:
// 2021-2025 average yield x Texas price received, already unit-converted by the pipeline (grossPerAcreUsd).
// The yield level can be the county, the district (a NASS region) or the state. The app must say so.
//
// Rotation "years" follow the bare-days rule (scoring/bareDays.js): every non-cover crop (cash crop, perennial,
// fallow) is one year; a cover crop rides along with the cash crop next to it. If a rotation is only cover crops,
// each one is its own year. Gross per acre per year = sum over priced years / number of priced years.
//
// Fertilizer value of nitrogen-fixing crops = nFixLbPerAcre range x N price x credit share (50%: cover crops
// don't hand over all the nitrogen they fix), averaged per rotation year. NASS has no fertilizer price series
// for Texas, so the N price comes from the USDA AMS Illinois Production Cost Report (bi-weekly, report 3195),
// a NATIONAL estimate, not Texas (content/economics.json, nPriceSource). Product price -> $/lb N:
//   anhydrous ammonia 82-0-0, Nov 13 2026: $981.11/ton / (2000 lb x 0.82 = 1640 lb N) = $0.598 -> $0.60/lb N (used)
//   urea 46-0-0:   $770.00/ton / (2000 x 0.46 = 920 lb N) = $0.837/lb N
//   UAN 28-0-0:    $467.86/ton / (2000 x 0.28 = 560 lb N) = $0.835/lb N
// Anhydrous is the cheapest N per pound, so the legume credit is not overstated.
// If nPriceSource is missing, `placeholder` is true and the app calls it a rough estimate.
//
// econ: parsed /content/economics.json. Returns null when the field has no market data (e.g. the fake sample).

const NASS = 'NASS Quick Stats';

// One crop's dollar status:
//   priced    NASS yield and price (gross per acre)
//   fallow    nothing sold ($0, counted as a year)
//   cover     cover crop: not sold, its value is soil and nitrogen
//   priceOnly NASS has a Texas price but no yield for our counties (alfalfa hay)
//   noData    no NASS yield or price (sesame, sorghum-sudangrass)
function cropDollars(crop, market) {
  if (crop.id === 'fallow') return { crop: crop.id, status: 'fallow', gross: 0 };
  const r = market.recent?.find((x) => x.crop === crop.id);
  if (r && r.grossPerAcreUsd != null) {
    return {
      crop: crop.id, status: 'priced', gross: r.grossPerAcreUsd,
      yield: r.yield, yieldUnit: r.yieldUnit, yieldLevel: r.yieldLevel, yieldYears: r.yieldYears,
      price: r.price, priceUnit: r.priceUnit, years: r.years,
    };
  }
  if (crop.marketType === 'cover') return { crop: crop.id, status: 'cover' };
  if (market.pricesTx?.some((p) => p.crop === crop.id)) return { crop: crop.id, status: 'priceOnly' };
  return { crop: crop.id, status: 'noData' };
}

export function estimateDollars(crops, field, econ) {
  const market = field?.market;
  if (!market || !econ) return null;

  // Rotation years (see the header): cover crops ride along unless the rotation is only cover crops.
  const yearCrops = crops.some((c) => !c.coverCrop) ? crops.filter((c) => !c.coverCrop) : crops;
  const years = yearCrops.length;

  // One entry per distinct crop for the card; the yearly average counts repeats (corn, corn, wheat).
  const seen = new Map();
  for (const c of crops) if (!seen.has(c.id)) seen.set(c.id, cropDollars(c, market));
  const byCrop = [...seen.values()];

  const priced = yearCrops.map((c) => seen.get(c.id)).filter((d) => d.status === 'priced' || d.status === 'fallow');
  const grossPerAcreYear = priced.length ? Math.round(priced.reduce((a, d) => a + d.gross, 0) / priced.length) : null;

  // Fertilizer value from nitrogen fixers, per rotation year. Unknown amounts (alfalfa) are listed, not guessed.
  const fixers = crops.filter((c) => c.nitrogenFixing && Array.isArray(c.nFixLbPerAcre) && c.nFixLbPerAcre[1] > 0);
  const perLb = econ.nPricePerLb * econ.nCreditShare;
  const fertilizer = fixers.length
    ? {
        lo: Math.round(fixers.reduce((a, c) => a + c.nFixLbPerAcre[0], 0) * perLb / Math.max(1, years)),
        hi: Math.round(fixers.reduce((a, c) => a + c.nFixLbPerAcre[1], 0) * perLb / Math.max(1, years)),
        crops: [...new Set(fixers.map((c) => c.id))],
        nPrice: econ.nPricePerLb, share: econ.nCreditShare,
        source: econ.nPriceSource ?? null,
        placeholder: !!econ.nPricePlaceholder || !econ.nPriceSource,
      }
    : null;
  const nUnknown = [...new Set(crops.filter((c) => c.nitrogenFixing && c.nFixLbPerAcre == null).map((c) => c.id))];

  const pricedCrops = byCrop.filter((d) => d.status === 'priced');
  return {
    grossPerAcreYear, pricedYears: priced.length, years,
    byCrop, fertilizer, nUnknown,
    levels: [...new Set(pricedCrops.map((d) => d.yieldLevel))],
    county: market.county, district: market.district, state: field.field?.state, priceState: market.priceState,
    period: pricedCrops[0]?.years ?? null,
    src: [NASS],
  };
}
