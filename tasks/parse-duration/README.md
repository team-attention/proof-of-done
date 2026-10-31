# parse-duration

`parseDuration(text)` turns a human duration into whole seconds.

- Units: `h`, `m`, `s`. Units can be combined in that order: `1h30m`, `2m5s`, `1h0m5s`.
- Spaces between parts are allowed: `1h 30m`.
- A part may be a decimal: `1.5h` is 5400.
- Anything else (empty string, unknown unit, no number, negative) throws an `Error`.

Run the visible tests with `bun test`.
