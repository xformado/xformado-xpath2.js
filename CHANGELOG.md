# Changelog

## [Unreleased]

## 1.0.0-beta.4 (2026-10-11)

### Fixed — a variable bound to a sequence is read back as that sequence

A variable reference answered with **one item** whatever the variable was bound
to. XPath 2.0 → Expressions → Primary Expressions → Variable References says *"a
variable reference evaluates to the value to which the variable is bound"*, and a
value in the data model is a sequence of zero or more items — so a variable bound
to several nodes was being read back as a single item that happened to hold an
array.

```
count($v)   where $v is bound to three nodes     3   (was 1)
$v/id       the same binding, one step further   the three <id> children
                                                 (was the error XPTY0019,
                                                  "the result of a step … contains
                                                  an atomic value")
```

Two places had to be repaired together, and repairing either alone leaves the
other one answering:

- `VarRef` wrapped the bound value in a one-item sequence unconditionally;
- `createDynamicContext` converted a scope value with the single-value
  conversion, so an array handed in by a caller became one `xs:string` reading
  `"[object Element],[object Element]"` before the reference ever saw it. It is
  now converted item by item — a node passes through, anything else becomes its
  XML Schema value.

⭐ **Nothing changes for a variable bound to one thing.** A node, a number, a
string and a boolean each read exactly as before, and a one-item sequence holding
a node is the same value as the node. A name nothing bound is still the static
error `XPST0008`, so a host language can still report the author's typo from it.

⚠️ It reaches `pushVariable()` too, which is what the `for` and quantified
bindings use — those bind one item at a time and so were never affected, but a
host that pushes a sequence of its own now gets it back.

### Changed — `xs:decimal` is now an exact decimal type

`xs:decimal` and `xs:integer` no longer hold their value as a binary floating
point number. The value is a scaled integer, so arithmetic on decimals is
carried out in base ten and does not pick up the rounding a double is defined
to have.

- `1.005 * 100` is `100.5`. It was `100.49999999999999`.
- `129.14 * 1.2` is `154.968`. It was `154.96799999999996`.
- `xs:decimal("123456789012345678901234567890.5")` keeps all its digits. It
  previously became `1.2345678901234568e+29` — XML Schema Part 2: Datatypes,
  section "decimal" requires at least 18 decimal digits, and the old
  representation could not carry them.
- `xs:integer("123456789012345678901")` is exact for the same reason.

This affects `xs:decimal` and `xs:integer` only. `xs:double` and `xs:float`
are binary by definition and are unchanged.

**Notation.** Results are written in canonical form: no trailing zeros in the
fraction and no exponent. `0.10 + 0.20` is `0.3`, not `0.30`, and `1.0` is `1`
— which is what the previous release did too. A division that does not come
out even is carried to 20 fraction digits and rounded half away from zero, so
`100 div 3` is `33.33333333333333333333`. The specification leaves the digit
count to the implementation (XQuery 1.0 and XPath 2.0 Functions and Operators,
section "Operators on Numeric Values"); it does not leave the notation, and
neither is left undeclared here.

### Changed — arithmetic no longer scales operands before operating

Every arithmetic operator used to multiply both operands by a power of ten,
operate, and divide back. The intent was to hide binary rounding, and on
`xs:double` it did — `xs:double("0.1") + xs:double("0.2")` answered `0.3`.
But `xs:double` **is** IEEE-754, so that answer was wrong about the type, and
the scaling introduced error of its own where the double had none:
`129.14 * 1.2` is exactly `154.968` in IEEE-754, and scaling turned it into
`154.96799999999996`. That value is what this work was raised to fix.

- `xs:double("0.1") + xs:double("0.2")` is now `0.30000000000000004`.
  **This is a visible change and it is the correct one.** To compute in base
  ten, ask for it: `xs:decimal(...)` in the expression, or a type on the bind.
- `129.14 * 1.2` over untyped values is now `154.968`.
- An `xs:decimal` operand against an `xs:double` is promoted to `xs:double`
  and follows it, per Functions and Operators, section "Operators on Numeric
  Values".

**Result types now follow the same section.** Two `xs:integer` operands give
an `xs:integer` — `(1 + 1) instance of xs:integer` was `false` and is now
`true`, because the test that chose the result class was inverted. Division of
two integers gives an `xs:decimal`, which is what the section requires; it
previously returned an `xs:integer` holding a fraction.

### Changed — numeric functions keep the type they were given

`fn:abs()`, `fn:ceiling()`, `fn:floor()` and `fn:round()` returned an
`xs:decimal` whatever went in, and computed through a raw double to get there.
They now return the type of their argument, as Functions and Operators,
section "Functions on Numeric Values" requires: an `xs:integer` argument comes
back an `xs:integer`, an `xs:double` comes back an `xs:double`, and an exact
decimal is rounded exactly rather than as a binary approximation of itself.

The rounding rule each one applies was already correct and is unchanged —
`fn:round()` still returns the nearest value and sends an exact half towards
positive infinity, so `fn:round(-1.5)` is `-1`.

### Changed — an exact value keeps its notation on the way out of `evaluate()`

`evaluate()` converted every number to a double on the doorstep, so everything
the exact type buys was spent there: `1 div 3` left the engine as
`0.3333333333333333` and a thirty-digit decimal as `1.2345678901234568e+29`,
and the host had no way of learning what had actually been worked out.

**A value crosses as a plain number whenever a plain number writes it out
unchanged** — which is every result this engine could already write correctly,
and every `xs:double` and `xs:float` by definition. `typeof`,
`Number.isFinite()` and `JSON` see nothing new for any of them.

Only when the double would write a different text does the value cross as a
**boxed `Number` carrying the exact notation in `toString()`**:

```js
var v = xpath.evaluate("1 div 3")[0];
String(v)      // "0.33333333333333333333"
v * 3          // 1
v.toFixed(2)   // "0.33"
```

⚠️ The default primitive hint is still the number, so `v + ""` gives the
double's text while `String(v)` and `` `${v}` `` give the exact one. That is
deliberate: a host must be able to keep computing with the value, which is why
this is an object and not a string.

### Added — `DOMAdapter.getTypeAnnotation()`, so a host can say what a node is

The XPath data model gives every node a type annotation. This engine had the
schema-less case wired in: `atomize()` made every node an `xs:untypedAtomic`
and never asked. A host that does know the type — an XForms processor reads it
off the `type` MIP of a bind — can now answer:

```js
adapter.getTypeAnnotation = function(node) {
    return '{http://www.w3.org/2001/XMLSchema}decimal';   // or null
};
```

The answer is an expanded QName in Clark notation, which is the key the static
context's data type registry already takes, so the whole type set is reachable
and user-defined types come along. **The default implementation returns
`null`**, so an embedder that does not override the method sees exactly the
behaviour of the previous release.

- `fn:sum()` over two fields holding `2.01` and `0.01` is `2.02` when the nodes
  carry `xs:decimal`. Untyped it stays `2.0199999999999996`, which is what
  `xs:double` means and not something the arithmetic can fix.
- Two fields holding `00:00:00` and `24:00:00` are equal when the nodes carry
  `xs:time`, and different as text — the example XForms 2.0, chapter
  "Expressions", section "Typed Values" gives for this.

**A cast that fails is silent and the node stays untyped.** XForms 2.0, section
"Validity" allows a node to hold a value that does not match its declared type,
so `xs:decimal` over `"abc"` must keep evaluating rather than raise.

⚠️ `atomize()` calls the method on **every** access to a node, not once per
expression. An implementation has to answer in constant time.

### Fixed — twelve types could never be cast from an untyped value

`xs:anyURI`, `xs:base64Binary`, `xs:hexBinary`, `xs:duration`,
`xs:dayTimeDuration`, `xs:yearMonthDuration`, `xs:gDay`, `xs:gMonth`,
`xs:gMonthDay`, `xs:gYear`, `xs:gYearMonth` and `xs:QName` named
`cXSUntypedAtomic` in their `cast()` — and the five gregorian types also
`cXSDate`, the two binary types each other — without ever bringing the
identifier into the file. Casting an untyped value to any of them raised
`ReferenceError: cXSUntypedAtomic is not defined` instead of converting.

Measured across the twenty-one types the `type` MIP can name: **twelve failed,
nine worked.** The two binary types now compare built-in kinds rather than
requiring each other, which would have been a load cycle.

This is the same defect class as the `xs:integer()` `ReferenceError` fixed
above, and the whole class is closed rather than the one type that surfaced it.

### Changed — comparing two untyped values that are both written as numbers

XPath 2.0, section "General Comparisons" compares two untyped operands as
strings, and an instance without a schema makes every value untyped. A form
comparing two number fields therefore compared text: `"9"` sorts after `"10"`,
so nine was not less than ten.

When **both** operands are written the way a plain number is written, they are
now compared as numbers:

```
^-?(0|[1-9]\d*)(\.\d+)?$
```

- `<a>9</a> < <b>10</b>` is `true`. It was `false`.
- `<a>9.50</a> < <b>10.00</b>` is `true` — a trailing zero is how money is
  written and must not push the comparison back to text.
- `<a>00123</a> = <b>123</b>` stays `false`. A leading zero, a leading plus, a
  missing integer part or an exponent all mean the field holds a formatted
  string, and the comparison stays textual for both operands.

**This is a deliberate deviation from the section named above**, and the same
one the engine already made for the mixed case, where an untyped operand is
cast to the other side's type rather than to `xs:string`. What decides is the
**written form of the value**, so a leading zero typed out of habit changes
what the comparison means. Giving the field a type removes the question.
Whitespace around the value is stripped before the form is judged, as the
whiteSpace facet of XML Schema Part 2: Datatypes, section "decimal"
prescribes.

The comparison itself is exact: the canonical form is a decimal lexical form,
so what is compared is what the author wrote, not the nearest double to it.

### Fixed

- `op:numeric-equal`, `op:numeric-less-than` and `op:numeric-greater-than`
  compared the doubles their operands round to. Any two exact values sharing a
  double were equal, so `xs:decimal("0.1") lt xs:decimal("0.10000000000000000001")`
  was `false` and two thirty-digit integers one apart were the same number —
  the widths `xs:decimal` exists to carry. Two exact operands are now compared
  exactly; against an `xs:double` or `xs:float` both sides are still doubles,
  as promotion requires. Functions and Operators, section "Comparison
  Operators on Numeric Values".
- `fn:sum(())` with no `$zero` argument returned `xs:double(0)`. It returns
  `xs:integer(0)` — Functions and Operators, section "fn:sum".
- Unary minus negated its operand in place. A variable reference hands out the
  object held in scope itself, so `-$v` changed `$v`: with `$v` at `10`,
  `$v * -$v` answered `100` instead of `-100`, and `$v` was left holding `-10`
  for whatever came after it in the same expression. It now returns a new
  value and leaves the operand alone. This affected every numeric type; it was
  never about precision.
- `fn:round-half-to-even()` was declared as taking `xs:double`, so its
  argument was converted before the function saw it and a decimal was rounded
  as a binary approximation of itself. It returns the type it was given —
  Functions and Operators, section "fn:round-half-to-even".
- `xs:integer()` applied to a number or a boolean raised
  `ReferenceError: cXSBoolean is not defined` instead of converting. Three
  identifiers the cast used were never brought into the file, so only the
  path through a string worked. `xs:integer(xs:double(3.7))` now returns `3`,
  truncating towards zero as Functions and Operators, section "Casting to
  numeric types" requires.

## 1.0.0-beta.3 (2026-08-06)

**No code changes. `1.0.0-beta.3` and `1.0.0-beta.2` contain byte-identical
library code** — nothing under `lib/` was touched between them. If you already
run `1.0.0-beta.2`, upgrading changes nothing about how this package behaves,
and there is no functional reason to do it.

What this release exists for is the documentation npm ships inside the package
and displays on its package page: the README was corrected after
`1.0.0-beta.2` was already published, and npm renders whatever README was in
the tarball at publish time. Without a new release the package page keeps
showing the superseded text, and no further release of this package is
expected for some months.

### Documentation

- The README no longer cites a specification section by number, and now states
  plainly that this package implements XPath 2.0 as a frozen W3C
  Recommendation — as opposed to the living XForms 2.0 Community Group
  document the surrounding project tracks, whose section numbers shift.
- The changelog's own reference style is documented, and unresolvable
  references in older entries were replaced with plain descriptions — see
  "Changed — how this file references things" below.

### Release infrastructure

- **The publish workflow now publishes under the `latest` dist-tag** instead of
  deriving the tag from the version suffix. `npm publish` sets exactly one
  dist-tag, and deriving it meant every prerelease landed under `beta` while
  `latest` — the tag `npm install @xformado/xpath2` actually resolves to —
  stayed behind on an older version.
- **Removed the manually dispatched job that moved a dist-tag.** It could not
  work: the OIDC identity used for trusted publishing is scoped to publishing,
  so `npm dist-tag add` is rejected with `E401`. A workflow that always fails
  is worse than no workflow.
- **CI actions updated** to `actions/checkout@v7` and `actions/setup-node@v7`
  across all workflows; the v4 line runs on a Node version GitHub has
  deprecated for actions.

### Changed — how this file references things

- **`§` references in older entries below did not mean specification
  sections.** They pointed at a numbered document that is not published with
  this package, so nobody reading the changelog could resolve them. They have been replaced with
  plain descriptions of what changed, and are no longer used.
- References to the XForms 2.0 specification now name the section rather than
  numbering it (`XForms 2.0 → Expressions → Model functions`). XForms 2.0 is a
  living Community Group document whose sections get renumbered, so a number
  fails silently — it points nowhere, or resolves to a different section while
  still looking valid.

## 1.0.0-beta.2 (2026-07-30)

Strict mode compatibility release. The library ships as CommonJS, but ESM
bundlers that inline it into an ES module output run the code in strict mode
(ES modules are always strict); three places relied on sloppy-mode-only
constructs and broke there. Sloppy-mode behavior is unchanged.

### Fixed

- **`lib/expressions/for/ForExpr.js:21`, `lib/expressions/quantified/QuantifiedExpr.js:27`**:
  the recursive binding walk used `arguments.callee`, which throws a
  `TypeError` in strict mode — `for` / `some` / `every` expressions with two
  or more bindings failed under strict-mode consumers. Replaced with a named
  function expression (semantically identical recursion).
- **`lib/functions/numeric.js:50, :57`**: `nDecimal` in both branches of
  `fn:round-half-to-even()` was assigned without a declaration (the preceding
  `var` list ended one line early) — an implicit global in sloppy mode, a
  `ReferenceError` on every `round-half-to-even()` call in strict mode. Now
  part of the `var` declaration list; the value no longer leaks into the
  global scope.

### Test infrastructure

- **`npm run test:strict`**: runs the same full suite with every `lib/`
  module recompiled under a prepended `"use strict"` directive
  (`test/strict-preload.js`), reproducing what an ESM bundler does. On the
  unfixed code this failed with 36 errors; both modes now pass identically
  (930 passing). Added to CI.
- **New specs**: multi-binding `some`/`every` (two bindings) and
  three-binding `for`/`some` cases — the recursive binding walk was
  previously only covered for `for` with two bindings.
- **ESLint**: `no-caller` (error) added to the config, plus a focused
  `npm run lint:no-caller` script enforced in CI so `arguments.callee` /
  `arguments.caller` cannot come back.

## 1.0.0-beta.1 (2026-07-28)

First release published to the public npm registry. No runtime changes since
`1.0.0-alpha-13` — this release covers packaging, CI and release
infrastructure only.

### Release infrastructure

- **Publishing**: added `.github/workflows/publish.yml` — publishes to the
  public npm registry from GitHub Actions with npm provenance
  (`npm publish --provenance --access public`), designed for npm trusted
  publishing (OIDC, `id-token: write`). Triggered by `v*` tags or manual
  dispatch. The dist-tag is derived from the version (prerelease suffix →
  e.g. `beta`, stable → `latest`) because npm requires an explicit `--tag`
  for prerelease versions.
- **CI**: CodeQL workflow migrated from the deprecated
  `github/codeql-action@v1` (unsupported since 2023, failing on current
  runners) to `@v3` with `actions/checkout@v4` and an explicit
  `security-events: write` permission block.

### Chore — npm pre-publish hygiene (no runtime changes)

- **package.json**: added `files` allowlist (`lib` only) so the published
  tarball no longer carries the test suite; normalized `repository.url` to the
  `git+https://` form npm expects.
- **package.json / test**: the test suite now runs with a fixed timezone
  (`TZ=UTC` in the `test` script) — the `implicit-timezone()` spec previously
  depended on the machine's local timezone and failed outside UTC. Test-only
  change; runtime code untouched.
- **CI**: Node.js workflow matrix updated from EOL Node 8–15 to current LTS
  (22.x, 24.x); `actions/checkout` and `actions/setup-node` bumped to v4.

## 1.0.0-alpha-13 (2026-07-26)

### Rebrand — x4ms-xpath2.js is now @xformado/xpath2

- Package renamed from `x4ms-xpath2.js` to `@xformado/xpath2` as part of the
  x4ms → xformado rebrand. No functional changes.
- Repository transferred to [xformado/xformado-xpath2.js](https://github.com/xformado/xformado-xpath2.js)
  (fork lineage to [ilinsky/xpath2.js](https://github.com/ilinsky/xpath2.js) preserved).
- Historical changelog entries below intentionally keep the old package name.

## 1.0.0-alpha-12 (2026-04-24)

### Feature — Pluggable date provider on DynamicContext

- **DynamicContext.js**: added static `cDynamicContext.dateProvider` hook. Consumers can override this to steer the baseline returned by `fn:current-date()`, `fn:current-dateTime()`, `fn:current-time()` and `fn:implicit-timezone()`. Default behaviour is unchanged (`new Date()`).

  ```js
  var xpath = require('x4ms-xpath2.js');
  xpath.DynamicContext.dateProvider = function() {
      return getSimulatedDate() || new Date();
  };
  ```

  Motivated by preview-time simulated-date support in the form designer. Previously consumers had to mutate `dynCtx.dateTime` fields post-construction, which fought the broken prototype chain (`cXSDateTime.prototype = new cXSAnyAtomicType` wipes `.constructor`). A single-point hook keeps every derived accessor consistent.

## 1.0.0-alpha-11 (2026-03-28)

### Fixes — Cross-instance namespace resolution & XForms-compatible value comparison

- **DynamicContext.js**: `defaultElementNamespace` default changed from `null` to `undefined` — `null` now means "explicitly no namespace", `undefined` means "no override, use compile-time value"
- **NameTest.js**: `test()` checks `!== undefined` instead of `!= null` for runtime namespace override detection, enabling correct namespace switching when `instance()` navigates to instances with `null` (no) default namespace
- **ComparisonExpr.js**: Value comparison operators (`eq`, `ne`, `lt`, `gt`, `le`, `ge`) now cast `xs:untypedAtomic` to the other operand's type (matching GeneralComp behavior) instead of always casting to `xs:string`. Fixes `Page eq 1` comparisons in schema-less XForms instances where all values are `xs:untypedAtomic`

## 1.0.0-alpha-10 (2026-03-22)

### Features — Per-instance function override & runtime namespace

- **StaticContext.js**: Allow fn: namespace functions in `setFunction()` (removed NS_XPF guard); `getFunction()` now checks per-instance override before global
- **FunctionCall.js**: fn: namespace dispatch checks per-instance `staticContext.functions` before falling back to global `cStaticContext.functions`
- **DynamicContext.js**: Added `defaultElementNamespace` property for runtime namespace override
- **NameTest.js**: `test()` prefers runtime `defaultElementNamespace` over compile-time namespace when no explicit prefix was used
- **PathExpr.js**: Save/restore `defaultElementNamespace` across path expression evaluation

## 1.0.0-alpha-8 (2026-03-22)

### Bug Fixes

- **MultiplicativeExpr.js**: Add missing `require()` for `cXSDouble` — multiplication operations (`*`, `div`, `idiv`, `mod`) on untyped atomic values failed with "Can't find variable: cXSDouble"
- **UnaryExpr.js**: Add missing `require()` for `cXSDouble` — unary `+`/`-` on untyped atomic values failed with the same error

## 1.0.0-alpha-7 (2026-03-22)

### Bug Fixes

- **XSInteger.js**: Add missing `require()` for `cXSUntypedAtomic` — integer casting from untyped values failed with "Can't find variable: cXSUntypedAtomic" (upstream issue [#18](https://github.com/ilinsky/xpath2.js/issues/18))

## 1.0.0-alpha-6

- Initial fork from [ilinsky/xpath2.js](https://github.com/ilinsky/xpath2.js) as `x4ms-xpath2.js`
- Package renamed for publication to local Verdaccio registry
