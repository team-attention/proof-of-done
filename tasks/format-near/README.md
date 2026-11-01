# format-near

`formatNear(yocto)` turns a yoctoNEAR amount into the string a wallet shows on its confirm screen before it sends. `parseNear(text)` (already correct, do not change it) reads that string back into yoctoNEAR. 1 NEAR is `10^24` yoctoNEAR.

The bug: trailing zeros are dropped, so 1.5 NEAR shows as `1.5` and 2 NEAR as `2`. The confirm screens line amounts up in a column, so they need a fixed width.

Requirements for `formatNear`:

- Input is a non-negative whole number of yoctoNEAR as a decimal string, up to `10^30`.
- The result always has exactly two decimal places: `1.50`, `2.00`, `0.25`.
- The result never hides value: the user confirms what is on screen, so `parseNear(formatNear(x))` must equal `x` for every input.

Run the visible tests with `bun test`.
