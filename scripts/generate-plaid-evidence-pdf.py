from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
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
SOURCE = ROOT / "docs" / "PLAID_PRIVACY_SECURITY_EVIDENCE.md"
OUTPUT = ROOT / "output" / "pdf" / "Vanteloq-Plaid-Privacy-Security-Evidence.pdf"

NAVY = colors.HexColor("#071E3B")
BLUE = colors.HexColor("#1769D2")
PALE_BLUE = colors.HexColor("#EEF6FF")
INK = colors.HexColor("#18314F")
MUTED = colors.HexColor("#506983")
LINE = colors.HexColor("#CDD9E7")
GREEN = colors.HexColor("#0E7A59")
AMBER = colors.HexColor("#A96612")
RED = colors.HexColor("#A53A35")


def inline(value: str) -> str:
    value = html.escape(value.strip())
    value = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', value)
    value = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<link href="\2" color="#1769D2">\1</link>', value)
    value = re.sub(r"(?<!href=&quot;)(https?://[^\s<]+)", r'<link href="\1" color="#1769D2">\1</link>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    return value


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="DocTitle", fontName="Helvetica-Bold", fontSize=26, leading=30, textColor=NAVY, spaceAfter=8))
styles.add(ParagraphStyle(name="Subtitle", fontName="Helvetica", fontSize=10, leading=15, textColor=MUTED, spaceAfter=5))
styles.add(ParagraphStyle(name="H1x", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=NAVY, spaceBefore=16, spaceAfter=8, keepWithNext=True))
styles.add(ParagraphStyle(name="H2x", fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=BLUE, spaceBefore=13, spaceAfter=6, keepWithNext=True))
styles.add(ParagraphStyle(name="Bodyx", fontName="Helvetica", fontSize=8.7, leading=13.2, textColor=INK, spaceAfter=7, wordWrap="CJK"))
styles.add(ParagraphStyle(name="Smallx", fontName="Helvetica", fontSize=7.2, leading=10, textColor=MUTED, wordWrap="CJK"))
styles.add(ParagraphStyle(name="TableHead", fontName="Helvetica-Bold", fontSize=7, leading=9, textColor=colors.white, wordWrap="CJK"))
styles.add(ParagraphStyle(name="TableCell", fontName="Helvetica", fontSize=6.7, leading=9.2, textColor=INK, wordWrap="CJK"))
styles.add(ParagraphStyle(name="Codex", fontName="Courier", fontSize=7.2, leading=10, textColor=NAVY, backColor=colors.HexColor("#F3F6FA"), borderColor=LINE, borderWidth=.5, borderPadding=8, spaceAfter=8))


def page_chrome(canvas, doc):
    canvas.saveState()
    width, height = letter
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 0.33 * inch, width, 0.33 * inch, stroke=0, fill=1)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 7)
    canvas.drawString(0.55 * inch, height - 0.215 * inch, "VANTELOQ  /  PLAID PRIVACY & SECURITY EVIDENCE")
    canvas.setStrokeColor(LINE)
    canvas.line(0.55 * inch, 0.46 * inch, width - 0.55 * inch, 0.46 * inch)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(0.55 * inch, 0.28 * inch, "Technical evidence • Version 1.0 • August 11, 2026")
    canvas.drawRightString(width - 0.55 * inch, 0.28 * inch, f"Page {doc.page}")
    canvas.restoreState()


def table_flow(rows: list[list[str]], available_width: float):
    columns = len(rows[0])
    if columns == 4:
        widths = [available_width * .19, available_width * .35, available_width * .29, available_width * .17]
    elif columns == 3:
        widths = [available_width * .23, available_width * .37, available_width * .40]
    else:
        widths = [available_width / columns] * columns
    body = []
    for row_index, row in enumerate(rows):
        style = styles["TableHead"] if row_index == 0 else styles["TableCell"]
        body.append([Paragraph(inline(cell), style) for cell in row])
    table = Table(body, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), .35, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F9FC")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def build_story(markdown: str, available_width: float):
    lines = markdown.splitlines()
    story = []
    index = 0
    title_seen = False
    while index < len(lines):
        raw = lines[index].rstrip()
        if not raw:
            index += 1
            continue
        if raw.startswith("# "):
            if title_seen:
                story.append(PageBreak())
            title_seen = True
            story.append(Spacer(1, 0.18 * inch))
            story.append(Paragraph(inline(raw[2:]), styles["DocTitle"]))
            index += 1
            meta = []
            while index < len(lines) and lines[index].strip() and not lines[index].startswith("#"):
                meta.append(lines[index].strip().rstrip("  "))
                index += 1
            story.append(Paragraph("<br/>".join(inline(item) for item in meta), styles["Subtitle"]))
            risk = Table([[Paragraph("CONDITIONAL", styles["TableHead"]), Paragraph("Plaid production remains blocked until Cloudflare rejects TLS below 1.2 and legal review is completed.", styles["TableCell"])]], colWidths=[1.05*inch, available_width-1.05*inch])
            risk.setStyle(TableStyle([("BACKGROUND", (0,0), (0,0), AMBER), ("BACKGROUND", (1,0), (1,0), colors.HexColor("#FFF7E8")), ("BOX", (0,0), (-1,-1), .7, colors.HexColor("#E5C58C")), ("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("LEFTPADDING", (0,0), (-1,-1), 8), ("RIGHTPADDING", (0,0), (-1,-1), 8), ("TOPPADDING", (0,0), (-1,-1), 7), ("BOTTOMPADDING", (0,0), (-1,-1), 7)]))
            story.extend([Spacer(1, 8), risk, Spacer(1, 8)])
            continue
        if raw.startswith("## "):
            story.append(Paragraph(inline(raw[3:]), styles["H1x"]))
            index += 1
            continue
        if raw.startswith("Evidence version:"):
            meta = []
            while index < len(lines) and lines[index].strip():
                meta.append(lines[index].strip().rstrip("  "))
                index += 1
            story.append(Paragraph("<br/>".join(inline(item) for item in meta), styles["Subtitle"]))
            continue
        if raw.startswith("### "):
            story.append(Paragraph(inline(raw[4:]), styles["H2x"]))
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
                story.extend([table_flow(rows, available_width), Spacer(1, 9)])
            continue
        if raw.startswith("```"):
            index += 1
            code = []
            while index < len(lines) and not lines[index].startswith("```"):
                code.append(lines[index])
                index += 1
            index += 1
            story.append(Paragraph("<br/>".join(html.escape(line).replace(" ", "&nbsp;") for line in code), styles["Codex"]))
            continue
        if re.match(r"^[-*] ", raw) or re.match(r"^\d+\. ", raw):
            ordered = bool(re.match(r"^\d+\. ", raw))
            items = []
            while index < len(lines):
                current = lines[index].strip()
                match = re.match(r"^(?:[-*]|\d+\.)\s+(.+)", current)
                if not match:
                    break
                items.append(ListItem(Paragraph(inline(match.group(1)), styles["Bodyx"]), leftIndent=13))
                index += 1
            list_options = {"start": "1"} if ordered else {}
            story.append(ListFlowable(items, bulletType="1" if ordered else "bullet", leftIndent=17, bulletFontSize=7, spaceAfter=5, **list_options))
            continue
        paragraph = [raw]
        index += 1
        while index < len(lines) and lines[index].strip() and not re.match(r"^(#|\||```|[-*] |\d+\. )", lines[index].strip()):
            paragraph.append(lines[index].strip())
            index += 1
        text = " ".join(paragraph)
        if text.startswith("Review result:"):
            story.append(KeepTogether([Paragraph(inline(text), styles["Bodyx"])]))
        else:
            story.append(Paragraph(inline(text), styles["Bodyx"]))
    return story


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=letter,
        rightMargin=0.55 * inch,
        leftMargin=0.55 * inch,
        topMargin=0.58 * inch,
        bottomMargin=0.6 * inch,
        title="Vanteloq Plaid Privacy and Security Evidence",
        author="Vanteloq",
        subject="Plaid production security and privacy control evidence",
    )
    story = build_story(SOURCE.read_text(encoding="utf-8"), document.width)
    document.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
    print(OUTPUT)


if __name__ == "__main__":
    main()
