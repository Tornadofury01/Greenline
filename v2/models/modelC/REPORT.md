# Model C: year types for North Texas (Field Shift v2)

**Season:** March–October, the 6-county study area, from gridMET daily weather averaged over the 1,711 fields, 1985–2025.

**Features (z-scored):** rain, heat days (≥ 35 °C), heavy-rain days (≥ 25 mm), mean daily high, water deficit (reference ET − rain), frost-free days.

**Method:** k-means with k = 4.
- **Silhouette by k:** {'3': 0.29, '4': 0.278, '5': 0.296, '6': 0.282}. k = 4 is kept: it is close to the best score and matches the plan's four types.
- **Agreement:** a Gaussian mixture agrees almost exactly (ARI **0.931**), and so does a hidden Markov model over years (ARI **0.918**).
- **Persistence:** the HMM's probability of staying in the same type the next year is [0.5, 0.35, 0.36, 0.0], so year types barely carry over from one year to the next.

## Year types, checked against data the model never saw

| Type | Years | Which | Drought Monitor: % area in D2+ (Mar–Oct, 2000+) | RMA drought / heat payouts per year | Area greenness z (Model B) | Wheat yield | Corn | Sorghum | Cotton |
|---|---|---|---|---|---|---|---|---|---|
| drought | 1 | 2011 | 76% | $36.0 M | -0.66 | -14% | -44% | -24% | -45% |
| hot | 10 | 1985, 1998, 1999, 2000, 2005, 2006, 2012, 2013, 2022, 2023 | 42% | $11.7 M | -0.13 | +7% | +0% | +6% | -11% |
| normal | 15 | 1987, 1988, 1990, 1992, 1993, 1994, 1996, 1997, 2001, 2002, 2003, 2008, 2010, 2014, 2017 | 6% | $2.8 M | +0.02 | +2% | -1% | +1% | +4% |
| wet | 15 | 1986, 1989, 1991, 1995, 2004, 2007, 2009, 2015, 2016, 2018, 2019, 2020, 2021, 2024, 2025 | 5% | $5.0 M | +0.33 | -5% | +3% | -6% | +8% |

**Yields** are the county yield's deviation from its trend, using one clean NASS series per crop.

**Drought** is one season (2011), the worst in 41 years. Everything else confirms the labels: three quarters of the area in severe drought, 2–3× the payouts of a hot year, greenness 0.7 z below normal, corn and cotton yields down about 45%.

**Hot** seasons are the second tier: 42% of the area in severe drought, cotton about −11%.

### Type centres (actual units)

| Type | Rain mm | Heat days | Heavy-rain days | Mean high °C | Deficit mm | Frost-free days |
|---|---|---|---|---|---|---|
| hot | 568.9 | 76.7 | 4.6 | 30.7 | 875.5 | 266.1 |
| normal | 625.4 | 46.1 | 4.1 | 29.3 | 680.4 | 246.6 |
| wet | 891.7 | 43.5 | 10.3 | 29.3 | 394.6 | 263.8 |
| drought | 325.5 | 133 | 2 | 33.8 | 1520.4 | 243 |

## 2040: how often each type comes

**Method:** NEX-GDDP-CMIP6, 8 models. Each model's change from its own 1985–2014 to 2030–2050 (rain ratio, warmer highs and lows, about 3% more reference ET per °C) is applied to every observed season, then classified with the same model. Each cell shows the mean share across the 8 models, with the range in brackets.

| Type | 1985–2025 | 2040, SSP2-4.5 | 2040, SSP5-8.5 |
|---|---|---|---|
| normal | 37% | 2% (0%–12%) | 0% (0%–2%) |
| wet | 37% | 22% (7%–37%) | 14% (5%–27%) |
| hot | 24% | 66% (51%–80%) | 73% (66%–85%) |
| drought | 2% | 10% (2%–17%) | 12% (7%–17%) |

**More drought seasons than today:** 7 of 8 models under SSP2-4.5, and 8 of 8 under SSP5-8.5.

**Limit:** the delta method keeps today's year-to-year swings and only shifts their average. If the swings themselves grow, as many models suggest, drought and wet years would both be more frequent than shown.

**Files:**
- `year_types.csv`: each year's type, its probability, and the checks.
- `model3.joblib`: k-means + scaler, used to classify any season, including simulated 2040 ones.
- `metrics.json`
