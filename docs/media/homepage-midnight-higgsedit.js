// Native Higgsfield compositions. Figures reconcile to the fictional homepage
// receipts and Data Studio sample. This illustrates existing product features.
export default async ({ project, rect, text, frame, path, media }) => {
  const ink = "#f5f7fb", muted = "#b4becd", blue = "#78b2ff", line = "#2d394a";
  const sheets = ["Overview", "Sales", "Margin", "Inventory", "Cash", "Data Quality", "Sources"];
  const t = (s, x, y, w, size = 28, color = ink, weight = 400) => text(s, { x, y, width: w, height: size * 1.7, fontFamily: "Inter", fontSize: size, fontWeight: weight, color });
  const r = (x, y, w, h, fill = "#0e1118", radius = 20) => rect({ x, y, width: w, height: h, fill, radius, strokeColor: line, strokeWidth: 1 });
  const gradient = { kind: "linear", angle: 125, stops: [{ offset: 0, color: "#151b25" }, { offset: 1, color: "#0e1118" }] };
  const enter = { enter: { from: { y: 18, opacity: 0 }, duration: .6, easing: "house" }, exit: { to: { opacity: 0 }, duration: .28, anchor: "end" } };
  const tile = (label, value, x, y, w = 522) => [r(x, y, w, 168, gradient, 18), t(label, x + 26, y + 19, w - 52, 26, muted), t(value, x + 26, y + 65, w - 52, 62, ink, 600)];
  const pane = (p, at, dur, name, title, sub, nodes) => p.compose(frame({ x: 104, y: 162, width: 1712, height: 818, layout: "none", motion: enter }, [
    t(title, 0, 0, 1712, 64, ink, 700), t(sub, 0, 94, 1712, 28, muted), ...nodes
  ]), { at, dur, name });
  async function base(dir, label) {
    const p = await project({ dir, size: "1920x1080", fps: 30, background: "#050608" });
    const logo = await p.add("/home/user/vanteloq-midnight-assets/vanteloq-glass-symbol.png");
    p.compose([
      media({ file: logo, x: 100, y: 57, width: 72, height: 58, fit: "contain" }),
      t("Vanteloq", 186, 62, 360, 36, ink, 600),
      r(1490, 62, 326, 56, "#101722", 28), t(label, 1510, 72, 287, 22, blue, 600),
      t("Product illustration · Fictional sample records", 104, 1007, 1280, 24, muted),
      t("vanteloq.com", 1520, 1007, 296, 24, blue, 600)
    ], { dur: 12, name: "Brand and source boundary" });
    return p;
  }
  const product = await base("/home/user/vanteloq-midnight-product", "ORIGIN 1.0");
  pane(product, 0, 4.15, "Dark commerce overview", "Your business, at a glance.", "Sales, stock and cash. With the records behind the numbers.", [
    r(0, 172, 1712, 612, gradient, 26), r(0, 172, 238, 612, "#0a0e15", 26),
    t("Sample workspace", 24, 202, 196, 18, ink, 600), t("Sample data · CAD", 24, 241, 196, 19, muted),
    r(18, 315, 202, 52, "#12376f", 12), t("Overview", 36, 326, 180, 24, blue, 600),
    ...["Sales", "Inventory", "BookLoQ", "Connections", "Data Studio"].map((s, i) => t(s, 36, 393 + i * 65, 180, 23, muted)),
    t("Workspace / Overview", 274, 200, 850, 22, muted), t("May 29 – Jun 25, 2026", 1294, 200, 388, 22, muted),
    ...tile("Recorded net revenue", "$24,593.61", 274, 252, 448),
    ...tile("Recorded gross profit", "$12,330.21", 756, 252, 448),
    ...tile("Recorded gross margin", "50.14%", 1238, 252, 440),
    r(274, 449, 928, 302, "#0e1118", 18), t("Sales performance", 300, 473, 840, 30, ink, 600),
    ...[0, 1, 2].map(i => r(308, 537 + i * 63, 856, 1, line, 0)),
    path({ x: 334, y: 549, width: 796, height: 112, d: "M0 66 L265 28 L530 112 L796 66", fill: "none", stroke: { color: blue, width: 5, cap: "round" }, animate: [{ property: "opacity", from: .15, to: 1, at: .4, duration: .9 }] }),
    ...["$6,151.83", "$6,277.46", "$6,012.49", "$6,151.83"].map((s, i) => t(s, 300 + i * 220, 684, 215, 23, muted)),
    r(1238, 449, 440, 302, "#0e1118", 18), t("Your next step", 1264, 473, 387, 30, ink, 600),
    t("Inspect the source.", 1264, 544, 387, 32, ink, 600), t("Review the records behind\na change before deciding.", 1264, 598, 387, 25, muted),
    t("420 recorded transactions", 1264, 702, 387, 22, blue, 600)
  ]);
  pane(product, 4, 4.15, "Records and context", "Go deeper than the total.", "Keep the recorded figures, their source and the next step together.", [
    r(0, 172, 1712, 612, gradient, 26),
    t("Sales / Sample receipts", 36, 202, 1300, 28, ink, 600),
    ...tile("Transactions", "420", 36, 266, 506), ...tile("Average transaction", "$58.56", 604, 266, 506), ...tile("Units sold", "1,269", 1172, 266, 504),
    r(36, 470, 1074, 270, "#0e1118", 18), t("A total you can trace.", 62, 497, 1000, 38, ink, 600),
    t("Compare the same dates. Open the recorded details.", 62, 565, 1000, 28, muted),
    t("Revenue is a sales measure, separate from cash or net profit.", 62, 636, 1000, 25, blue),
    r(1172, 470, 504, 270, "#0e1118", 18), t("Make the view yours.", 1198, 497, 450, 36, ink, 600),
    t("Choose metrics. Set targets.\nFollow the progress.", 1198, 565, 450, 29, muted),
    t("Your business. Your priorities.", 1198, 674, 450, 24, blue, 600)
  ]);
  const studioOverview = () => [
    r(0, 172, 1712, 612, gradient, 26), t("Data Studio / Executive Review", 36, 200, 1250, 31, ink, 600),
    t("Sample records · CAD", 1380, 206, 290, 20, muted),
    ...tile("Recorded net sales", "$14,200", 36, 278), ...tile("Recorded gross profit", "$5,200", 594, 278), ...tile("Weighted gross margin", "36.6%", 1152, 278, 524),
    r(36, 480, 1640, 72, "#101722", 14),
    ...sheets.map((s, i) => t(s, 60 + i * 232, 498, 226, 24, i === 0 ? blue : muted, 600)),
    t("Seven sheets. Ready for Excel.", 36, 602, 1560, 46, ink, 600),
    t("Sales, margins and permitted BookLoQ figures.", 36, 682, 1520, 29, muted),
    t("Source notes travel with the workbook.", 36, 731, 1520, 27, blue)
  ];
  pane(product, 8, 4, "New Data Studio", "Meet Vanteloq Data Studio.", "Turn your recorded figures into a clear Executive Review.", studioOverview());
  await product.frame(2.2, "renders/poster.png");
  await product.frame(6.0, "renders/detail.png");
  await product.frame(10.0, "renders/studio.png");

  const studio = await base("/home/user/vanteloq-midnight-studio", "NEW · DATA STUDIO");
  pane(studio, 0, 4.15, "Studio overview", "Your numbers. Ready for Excel.", "One Executive Review. Seven sheets. The source notes stay with it.", studioOverview());
  pane(studio, 4, 4.15, "Source rows", "See the records behind the review.", "Inspect recorded sales and known costs before exporting.", [
    r(0, 172, 1712, 612, gradient, 26), t("Executive Review / Sales", 36, 202, 1300, 31, ink, 600),
    r(36, 284, 1640, 74, "#151b25", 12),
    ...["Record", "Business date", "Net sales", "Known cost"].map((s, i) => t(s, [62, 404, 922, 1328][i], 302, [315, 485, 376, 322][i], 26, muted, 600)),
    ...[["0001", "2026-09-01", "$8,700", "$5,500"], ["0002", "2026-09-02", "$5,700", "$3,600"], ["0003", "2026-09-03", "-$200", "-$100"]].flatMap((row, i) => [
      r(36, 382 + i * 99, 1640, 80, "#0e1118", 12),
      ...row.map((s, j) => t(s, [62, 404, 922, 1328][j], 396 + i * 99, [315, 485, 376, 322][j], 36, j < 2 ? muted : ink, j < 2 ? 400 : 600))
    ]),
    t("Missing costs stay blank. They never become zero.", 36, 714, 1620, 30, blue, 600)
  ]);
  pane(studio, 8, 4, "Excel review", "Take the context with you.", "An Excel workbook for your next business review.", [
    r(0, 172, 598, 612, gradient, 26), t("Executive Review.xlsx", 34, 206, 530, 34, ink, 600),
    ...sheets.map((s, i) => [r(26, 284 + i * 64, 546, 52, i === 0 ? "#12376f" : "#101722", 10), t(s, 44, 294 + i * 64, 510, 26, i === 0 ? blue : muted, 600)]).flat(),
    r(632, 172, 1080, 612, gradient, 26), t("Seven sheets. One clear review.", 666, 216, 1012, 45, ink, 600),
    t("Sales and margin", 666, 316, 1012, 34, ink, 600), t("Recorded totals and underlying rows.", 666, 371, 1012, 28, muted),
    t("Data Quality and Sources", 666, 453, 1012, 34, ink, 600), t("Scope, source notes and missing information.", 666, 509, 1012, 28, muted),
    r(666, 618, 742, 94, "#1d60dc", 16), t("Reports  /  Data Studio", 698, 643, 678, 32, "#ffffff", 600),
    t("Workspace permissions apply.", 666, 739, 990, 24, muted)
  ]);
  await studio.frame(2.2, "renders/poster.png");
  await studio.frame(6.0, "renders/rows.png");
  await studio.frame(10.0, "renders/workbook.png");
};
