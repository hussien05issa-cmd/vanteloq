# Vanteloq Studio Sheets, 12 October 2026

## Product boundary

Sheets receives the existing, authorized `StudioExecutiveReview`. It presents protected source rows and a separate editable assumption definition. It sends no source mutation, provider request, file upload or workbook edit. The containing Studio workspace owns access checks, current source scope, definition persistence and exports.

`StudioSheetDraft` contains only `version`, `title` and declared cells with `address`, `name`, `input` and `format`. The strict validator rejects additional keys, source rows, calculated results and snapshot metadata. Evaluate and validate again at the server persistence boundary; client validation is not an authorization boundary. Calculation results always use the supplied review and include its current snapshot hash outside the draft. Local edit history clears when the review organization changes. The containing workspace should also key the component by the selected saved definition when switching between analyses.

## Primary research and implementation decisions

- [W3C APG, Table Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/) recommends native HTML tables when available and describes embedded controls as individual tab stops. The small assumption sheet uses native input and select controls inside a semantic table. Source tables retain captions, column headings, sort state and an accessible horizontal scroll region.
- [W3C APG, Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) describes a grid as a composite widget requiring managed focus and directional navigation. This implementation deliberately uses normal table and form semantics. It does not advertise a spreadsheet grid or claim support for spreadsheet selection, arrow navigation, clipboard ranges or fill handles. Enter commits an input by blurring it; Escape restores the current edit. Browser text editing and input undo remain available. Sheet Undo and Redo buttons maintain at most 40 committed definitions.
- [Microsoft, Protect a worksheet](https://support.microsoft.com/en-us/excel/protect-a-worksheet) distinguishes editable input cells from locked worksheet cells and states that worksheet protection is not a security mechanism. The UI adopts the separation between recorded values and assumption inputs. Actual business and margin access remains the server's responsibility; restricted margin values are excluded from presentation and formula source access, even if stale values exist in the supplied object.
- [Microsoft, SUM function](https://support.microsoft.com/en-us/excel/functions/sum-function) documents adding values and ranges. The supported subset permits expressions and bounded rectangular ranges of declared assumption cells. Missing or empty cells report errors rather than adopting Excel's broader blank and text coercion rules.
- [Microsoft, IF function](https://support.microsoft.com/en-us/excel/functions/if-function) describes a test choosing between two outcomes. The supported subset accepts numeric tests and numeric comparisons, then evaluates only the selected branch. Strings, logical functions and Excel compatibility are not promised.

## Formula contract

Numeric inputs support an optional sign and decimal notation, including `.5`. A formula begins with `=` and may contain numeric literals, unary signs, `+`, `-`, `*`, `/`, parentheses, `NET_SALES`, `GROSS_PROFIT`, `TRANSACTIONS` and declared addresses from `A1` through `Z99`. Input is case insensitive for references and functions. User cell names are descriptive labels, not reference aliases.

`SUM(expr, ...)` accepts one or more numeric expressions and rectangular cell ranges such as `SUM(A1:A3,10)`. A range must move from its upper left to lower right corner and contain at most 32 declared cells. `IF(test,trueValue,falseValue)` accepts exactly three arguments. Tests support `=`, `<>`, `<`, `>`, `<=` and `>=`, or nonzero numeric truth. Comparisons cannot become arithmetic operands or a final numeric result.

Money source references convert canonical integer cents directly to exact decimal values. Transaction references retain integer counts. Arithmetic uses a BigInt coefficient and explicit decimal scale, with at most 12 decimal places and 40 coefficient digits. Division reduces the rational result and accepts only exactly terminating decimals within that scale. Currency and percentage presentation round to two decimal places, with the unchanged exact result shown underneath.

Errors are explicit: `SYNTAX`, `NAME`, `REFERENCE`, `EMPTY`, `CYCLE`, `DIV_ZERO`, `PRECISION`, `LIMIT`, `TYPE`, `MISSING_SOURCE` and `RESTRICTED`. No absent or restricted source value becomes zero. Zero is valid when a user enters it or a chosen IF branch returns it. Nonterminating division returns `PRECISION`, so a gross margin ratio may need another analysis view for its displayed percentage.

Definitions allow 1 to 32 cells, titles up to 80 characters, cell labels up to 40 characters and input up to 256 characters. Parsing caps formulas at 128 tokens and 40 levels of nesting. External references, string literals, scientific notation, dynamic code, macros, provider functions, arbitrary names and functions beyond SUM and IF are unsupported. Formulas do not evaluate JavaScript.

## Source inspection and scenario defaults

Source rows support stable ascending or descending column sorting, a date/location/source text filter, a location selector, optional source and units columns and 50-row pagination. Source cells are read only. Margin permission removes cost and profit columns entirely. Unavailable sales states do not expose stale row arrays. Sorting and filtering affect presentation only; scenario references continue to use totals from the complete authorized reporting scope.

The starter scenario supplies example 5% sales growth, 3% cost growth and zero additional operating costs. Its formulas derive recorded costs from net sales less gross profit, project sales and cost separately, calculate scenario gross profit and deduct only the entered additional operating costs. The last value is not labelled net income or operating profit because existing operating costs, taxes and other expenses are absent from this scenario.

## Verification and limits

`tests/studio-formulas.test.ts` checks exact decimal arithmetic and large money values, invalid division and bounds, missing and restricted source states, dependencies and cycles, SUM ranges, lazy IF, unsupported executable syntax, refreshed review values, persistable definition validation, display rounding and rendered accessible input labels with restricted-value suppression. The existing source-value fixtures remain relevant to cents and quantity validation.

Browser keyboard interaction, visual responsiveness, server persistence and live authenticated permission changes require integration verification by the containing Studio workspace. The component does not imply that an uploaded or exported XLSX remains live, nor that Excel's full formula language is available.
