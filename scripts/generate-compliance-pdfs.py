from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"

NAVY = colors.HexColor("#061F3D")
COBALT = colors.HexColor("#1769D2")
TEAL = colors.HexColor("#0E806F")
INK = colors.HexColor("#17304C")
MUTED = colors.HexColor("#526A82")
LINE = colors.HexColor("#CCD9E7")
PALE = colors.HexColor("#F4F8FC")
AMBER = colors.HexColor("#9A6011")
PALE_AMBER = colors.HexColor("#FFF5DE")


@dataclass(frozen=True)
class PdfSpec:
    source: Path
    output: Path
    short_title: str
    status: str
    banner: str
    subject: str


SPECS = (
    PdfSpec(
        source=ROOT / "docs" / "compliance" / "INFORMATION_SECURITY_POLICY.md",
        output=OUTPUT_DIR / "Vanteloq-Information-Security-Policy.pdf",
        short_title="INFORMATION SECURITY POLICY",
        status="DRAFT FOR APPROVAL",
        banner="Owner signature is required before this policy is represented as adopted or uploaded to Plaid.",
        subject="Vanteloq information security governance and control policy",
    ),
    PdfSpec(
        source=ROOT / "docs" / "compliance" / "DATA_RETENTION_AND_DISPOSAL_POLICY.md",
        output=OUTPUT_DIR / "Vanteloq-Data-Retention-and-Disposal-Policy.pdf",
        short_title="DATA RETENTION & DISPOSAL POLICY",
        status="DRAFT FOR APPROVAL",
        banner="Owner signature is required before this policy is represented as adopted or uploaded to Plaid.",
        subject="Vanteloq retention, deletion, and disposal policy",
    ),
    PdfSpec(
        source=ROOT / "docs" / "compliance" / "PLAID_SECURITY_QUESTIONNAIRE_ANSWER_GUIDE.md",
        output=OUTPUT_DIR / "Vanteloq-Plaid-Security-Questionnaire-Answer-Guide.pdf",
        short_title="PLAID QUESTIONNAIRE ANSWER GUIDE",
        status="OWNER REVIEW",
        banner="Do not submit yet: the production edge still accepts TLS 1.1 and several answers require owner verification.",
        subject="Verified answer guide and evidence map for the Plaid security questionnaire",
    ),
    PdfSpec(
        source=ROOT / "docs" / "compliance" / "IDENTITY_AND_ACCESS_CONTROL_EVIDENCE.md",
        output=OUTPUT_DIR / "Vanteloq-Identity-and-Access-Control-Evidence.pdf",
        short_title="IDENTITY & ACCESS CONTROL EVIDENCE",
        status="OWNER VERIFICATION",
        banner="Upload for access-control evidence. Critical-system MFA remains conditional until every administrator is verified.",
        subject="Vanteloq identity, RBAC, MFA, session, and access-control evidence for Plaid",
    ),
)


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="VTTitle", fontName="Helvetica-Bold", fontSize=24, leading=28, textColor=NAVY, spaceAfter=10))
styles.add(ParagraphStyle(name="VTH1", fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=NAVY, spaceBefore=13, spaceAfter=7, keepWithNext=True))
styles.add(ParagraphStyle(name="VTH2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=COBALT, spaceBefore=10, spaceAfter=5, keepWithNext=True))
styles.add(ParagraphStyle(name="VTBody", fontName="Helvetica", fontSize=8.4, leading=12.6, textColor=INK, spaceAfter=6, wordWrap="CJK"))
styles.add(ParagraphStyle(name="VTQuote", fontName="Helvetica", fontSize=8.2, leading=12.3, textColor=INK, leftIndent=12, rightIndent=7, borderColor=COBALT, borderWidth=0, borderLeftWidth=2, borderPadding=7, backColor=PALE, spaceAfter=7))
styles.add(ParagraphStyle(name="VTTableHead", fontName="Helvetica-Bold", fontSize=6.6, leading=8.5, textColor=colors.white, wordWrap="CJK"))
styles.add(ParagraphStyle(name="VTTableCell", fontName="Helvetica", fontSize=6.3, leading=8.5, textColor=INK, wordWrap="CJK"))
styles.add(ParagraphStyle(name="VTCode", fontName="Courier", fontSize=7.1, leading=9.5, textColor=NAVY, backColor=PALE, borderColor=LINE, borderWidth=.5, borderPadding=7, spaceAfter=6))


def inline(value: str) -> str:
    value = html.escape(value.strip())
    value = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', value)
    value = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<link href="\2" color="#1769D2">\1</link>', value)
    value = re.sub(r"(?<!href=&quot;)(https?://[^\s&lt;]+)", r'<link href="\1" color="#1769D2">\1</link>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    return value


def table_widths(columns: int, width: float) -> list[float]:
    ratios = {
        2: [0.27, 0.73],
        3: [0.22, 0.34, 0.44],
        4: [0.17, 0.35, 0.22, 0.26],
        5: [0.11, 0.35, 0.17, 0.16, 0.21],
    }.get(columns)
    if ratios is None:
        return [width / columns] * columns
    return [width * ratio for ratio in ratios]


def table_flow(rows: list[list[str]], width: float) -> Table:
    column_count = len(rows[0])
    normalized = [row[:column_count] + [""] * (column_count - len(row)) for row in rows]
    body = []
    for row_index, row in enumerate(normalized):
        style = styles["VTTableHead"] if row_index == 0 else styles["VTTableCell"]
        body.append([Paragraph(inline(cell), style) for cell in row])
    table = Table(body, colWidths=table_widths(column_count, width), repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), .35, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def is_block_start(value: str) -> bool:
    stripped = value.strip()
    return bool(re.match(r"^(#|\||```|>|[-*] |\d+\. )", stripped))


def build_story(markdown: str, width: float, spec: PdfSpec):
    lines = markdown.splitlines()
    story = []
    index = 0
    title_seen = False
    while index < len(lines):
        raw = lines[index].rstrip()
        if not raw.strip():
            index += 1
            continue
        if raw.startswith("# "):
            if title_seen:
                story.append(PageBreak())
            title_seen = True
            story.extend([Spacer(1, 0.16 * inch), Paragraph(inline(raw[2:]), styles["VTTitle"])])
            status_width = 1.58 * inch
            status_table = Table([
                [Paragraph(spec.status, styles["VTTableHead"]), Paragraph(inline(spec.banner), styles["VTTableCell"])],
            ], colWidths=[status_width, width - status_width])
            status_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (0, 0), AMBER),
                ("BACKGROUND", (1, 0), (1, 0), PALE_AMBER),
                ("BOX", (0, 0), (-1, -1), .7, colors.HexColor("#E1BD78")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]))
            story.extend([status_table, Spacer(1, 8)])
            index += 1
            continue
        if raw.startswith("## "):
            story.append(Paragraph(inline(raw[3:]), styles["VTH1"]))
            index += 1
            continue
        if raw.startswith("### "):
            story.append(Paragraph(inline(raw[4:]), styles["VTH2"]))
            index += 1
            continue
        if raw.startswith("|"):
            rows = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                    rows.append(cells)
                index += 1
            if rows:
                story.extend([table_flow(rows, width), Spacer(1, 7)])
            continue
        if raw.startswith(">"):
            quote = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote.append(lines[index].strip().lstrip(">").strip().rstrip("  "))
                index += 1
            story.append(Paragraph("<br/>".join(inline(item) for item in quote), styles["VTQuote"]))
            continue
        if raw.startswith("```"):
            index += 1
            code = []
            while index < len(lines) and not lines[index].startswith("```"):
                code.append(lines[index])
                index += 1
            index += 1
            story.append(Paragraph("<br/>".join(html.escape(line).replace(" ", "&nbsp;") for line in code), styles["VTCode"]))
            continue
        if re.match(r"^[-*] ", raw) or re.match(r"^\d+\. ", raw):
            ordered = bool(re.match(r"^\d+\. ", raw))
            items = []
            while index < len(lines):
                match = re.match(r"^(?:[-*]|\d+\.)\s+(.+)", lines[index].strip())
                if not match:
                    break
                items.append(ListItem(Paragraph(inline(match.group(1)), styles["VTBody"]), leftIndent=12))
                index += 1
            options = {"start": "1"} if ordered else {}
            story.append(ListFlowable(items, bulletType="1" if ordered else "bullet", leftIndent=17, bulletFontSize=7, spaceAfter=4, **options))
            continue

        paragraph = [raw.strip().rstrip("  ")]
        index += 1
        while index < len(lines) and lines[index].strip() and not is_block_start(lines[index]):
            paragraph.append(lines[index].strip().rstrip("  "))
            index += 1
        story.append(Paragraph(" ".join(inline(item) for item in paragraph), styles["VTBody"]))
    return story


def page_chrome(spec: PdfSpec):
    def draw(canvas, doc):
        canvas.saveState()
        page_width, page_height = letter
        canvas.setFillColor(NAVY)
        canvas.rect(0, page_height - 0.34 * inch, page_width, 0.34 * inch, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawString(0.55 * inch, page_height - 0.22 * inch, f"VANTELOQ  /  {spec.short_title}")
        canvas.setStrokeColor(LINE)
        canvas.line(0.55 * inch, 0.46 * inch, page_width - 0.55 * inch, 0.46 * inch)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(0.55 * inch, 0.28 * inch, "Version 1.0  •  Prepared August 13, 2026  •  Confidential compliance material")
        canvas.drawRightString(page_width - 0.55 * inch, 0.28 * inch, f"Page {doc.page}")
        canvas.restoreState()
    return draw


def build(spec: PdfSpec) -> None:
    spec.output.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(spec.output),
        pagesize=letter,
        rightMargin=0.55 * inch,
        leftMargin=0.55 * inch,
        topMargin=0.58 * inch,
        bottomMargin=0.6 * inch,
        title=spec.source.stem.replace("_", " ").title(),
        author="Vanteloq",
        subject=spec.subject,
    )
    story = build_story(spec.source.read_text(encoding="utf-8"), document.width, spec)
    chrome = page_chrome(spec)
    document.build(story, onFirstPage=chrome, onLaterPages=chrome)
    print(spec.output)


def main() -> None:
    for spec in SPECS:
        build(spec)


if __name__ == "__main__":
    main()
