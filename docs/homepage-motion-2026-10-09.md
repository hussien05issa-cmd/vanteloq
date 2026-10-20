# Vanteloq v1.0 Origin: dashboard and homepage motion update

Date: 9 October 2026.

The homepage preview renders the same ExecutiveOverview component and shared commerce styles used inside the workspace. This update strengthens label contrast, refines card edges and spacing, adds restrained blue and purple depth, and keeps four standard KPI cards in the desktop homepage row. Mobile uses two columns with readable amounts and touch controls. The selected metric, source records, goals and customization remain functional.

The homepage computer frame receives a subtle entry reveal and pointer-responsive lighting. Interaction cancels the entry animation. Motion controls honour the browser preference and the operating system's reduced-motion setting. Feature-carousel and connector-detail scrolling follow the same preference.

The Higgsfield product film uses locked pixels from the real sample interface rather than generated financial text. Its figures are fictional and labelled as samples. It plays only after an explicit request, uses native controls, and pauses when the page is hidden or the player is outside the viewport. The homepage does not request an MP4 source before Play. A friendly retry and a working demo link remain available if playback fails.

Existing authenticated dashboard refresh behaviour is preserved. Completed source-sync timestamps, source row counts and metric timestamps contribute to its refresh key. Period, comparison, location and accounting basis changes trigger a scoped request. Loading and failed requests do not silently present figures from a previous scope. Provider refresh speed still depends on the connector and its sync schedule.

## Verification

- Type checking passed.
- Lint completed with zero errors and 11 existing warnings outside these changed components.
- All 68 focused chart geometry, chart rendering, financial presentation, sample reconciliation, hydration and homepage tests passed.
- The wider interaction suite passed 57 of 61 tests. Four source-string assertions also failed identically in isolated baseline commit 5f9d38454717f856de5bd5c1b7118bcb6ea9c27f. They refer to an old motion implementation, a previous connector-tab initializer, a relocated Settings label and an outdated billing exception list. They are not new failures from this update.
- Browser checks covered desktop and mobile layout, customization opening and closing, Gross Margin expansion and focus return, the disconnected state, motion off, keyboard date inspection and a touch/click value readout. The page had no horizontal overflow at 320px and 390px. No video source was present before Play. The selected text colours measure at least 6.32:1 against the tested white and pale glass surfaces; this is a bounded colour check, not a complete accessibility certification.

No financial formulas, customer records, plan prices, permissions, provider availability or database schema were changed. Only the fictional demo receipt dates were redistributed within their original weeks and calendar months; every receipt amount, cost, identity, prior-period record and aggregate total is preserved. This document records this update only; it does not certify unrelated billing, backup, legal or third-party approval pathways.

## Line chart refinement

The Executive Overview, expanded metric panel, financial trend charts and KPI sparklines use smooth presentation paths through exact observations. The geometry follows bounded PCHIP slopes, with no overshoot beyond each neighbouring pair of values. It never replaces records with interpolated accounting data. Missing dates and unknown values still break the main line and area. Isolated records remain visible. Date selection, keyboard arrows, source inspection and data tables retain exact amounts.

The plotted group reveals over 500 milliseconds while axes and values remain available immediately. Interaction, visibility changes, motion off and interrupted updates cancel to the completed plot. Mobile uses separated date labels and a compact value readout.

The original fictional receipts repeated a three-day cycle. Whole sample receipts now follow varied daily visits, preserving all four weekly sales totals, May/June totals, 420 transactions and the displayed 28-day net revenue of CAD 24,593.61. This affects only the public fictional fixture, never customer data.

Geometry reference: https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html

## Kansei-informed finish

Desired feelings are translated into design features: precision through exact values and clear sources; calm through readable navy figures and restrained grids; control through selection, keyboard inspection and explicit motion settings; premium quality through refined edges, aligned surfaces and subtle glass depth; responsiveness through brief transitions and manual, deferred video playback. Caption and compact date labels use at least 12px. These are design hypotheses for evaluation, not claims of measured consumer preference.

Method reference: Nagamachi (1995), Kansei Engineering: A new ergonomic consumer-oriented technology for product development. DOI: 10.1016/0169-8141(94)00052-5.
