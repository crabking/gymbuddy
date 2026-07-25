# Common exercise expansion checklist

This is the release checklist for the common exercise expansion. A row is complete only
when the canonical catalog entry, database migration, coach prompt availability, and unique
960×640 production guide are all verified.

## Existing guides clarified

- [x] `barbell-curl` — already canonical and illustrated
- [x] `skullcrusher` — clarified as Lying EZ-Bar Skullcrusher; existing guide matches
- [x] `triceps-pushdown` — clarified as Rope Triceps Pushdown; existing guide matches

## New guides

- [x] `high-bar-back-squat`
- [x] `smith-machine-squat`
- [x] `single-leg-leg-press`
- [x] `single-leg-squat`
- [x] `step-up`
- [x] `dumbbell-romanian-deadlift`
- [x] `single-leg-romanian-deadlift`
- [x] `machine-hip-thrust`
- [x] `smith-machine-hip-thrust`
- [x] `back-extension-machine`
- [x] `cable-glute-kickback`
- [x] `seated-hip-abduction`
- [x] `seated-hip-adduction`
- [x] `nordic-hamstring-curl`
- [x] `leg-press-calf-raise`
- [x] `smith-machine-incline-press`
- [x] `pec-deck`
- [x] `high-to-low-cable-fly`
- [x] `weighted-chest-dip`
- [x] `arnold-press`
- [x] `machine-shoulder-press`
- [x] `cable-lateral-raise`
- [x] `t-bar-row`
- [x] `single-arm-lat-pulldown`
- [x] `straight-arm-cable-pulldown`
- [x] `chin-up`
- [x] `seated-dumbbell-curl`
- [x] `seated-ez-bar-curl`
- [x] `ez-bar-preacher-curl`
- [x] `cable-curl`
- [x] `bayesian-cable-curl`
- [x] `lying-dumbbell-skullcrusher`
- [x] `cable-overhead-rope-extension`
- [x] `single-arm-cable-pushdown`
- [x] `side-plank`
- [x] `reverse-crunch`
- [x] `pallof-press`
- [x] `power-clean`
- [x] `kettlebell-swing`
- [x] `sled-push`
- [x] `farmers-carry`

## Release gates

- [x] All runtime catalog tests pass
- [x] The full migration chain contains 96 unique exercises
- [x] The configured project database is migrated to 96 unique exercises
- [x] Every catalog ID is injected into the coach's live exercise catalog
- [x] Every catalog row has a unique 960×640 WebP guide
- [x] Production build succeeds
