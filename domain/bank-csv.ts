import { isCalendarDate } from "./calendar-date.ts";
import { reviewedBankStatement, type StatementRow } from "./bank-statement.ts";

export type CsvMapping = { delimiter: ","|";"|"\t"; dateColumn: number; descriptionColumn: number; amountColumn: number | null; moneyInColumn: number | null; moneyOutColumn: number | null; dateFormat: "ymd"|"mdy"|"dmy"; decimalFormat: "dot"|"comma"; positiveMeans: "in"|"out" };
export function parseBankCsv(text: string, delimiter: string): string[][] {
  if (typeof text!=="string" || !text.length || new TextEncoder().encode(text).length>300_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw Error("Use a UTF-8 CSV file of up to 300 KB without binary or control characters.");
  if(new TextDecoder("utf-8",{ignoreBOM:true}).decode(new TextEncoder().encode(text))!==text)throw Error("The CSV contains invalid Unicode. Export a valid UTF-8 file again.");
  if (![",",";","\t"].includes(delimiter)) throw Error("Choose comma, semicolon or tab as the separator.");
  const input=text.replace(/^\uFEFF/,"");
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false,closed=false;
  const endCell=()=>{if(cell.length>3000)throw Error(`CSV row ${rows.length+1} contains a cell longer than 3,000 characters.`);row.push(cell);if(row.length>32)throw Error("A bank CSV can contain at most 32 columns.");cell="";closed=false;};
  const endRow=()=>{endCell();if(row.some(c=>c.trim()))rows.push(row);row=[];if(rows.length>501)throw Error("Import up to 500 bank movements per CSV, plus the header.");};
  for(let i=0;i<input.length;i++) {
    const c=input[i];
    if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw Error(`CSV row ${rows.length+1} has an unexpected quote.`);quoted=true;}
    else if(c===delimiter)endCell();
    else if(c==='\r'||c==='\n'){if(c==='\r'&&input[i+1]==='\n')i++;endRow();}
    else {if(closed)throw Error(`CSV row ${rows.length+1} contains text after a closing quote.`);cell+=c;}
  }
  if(quoted)throw Error("The CSV ends inside a quoted cell. Export the complete file again.");
  if(cell||row.length||closed)endRow();
  if(rows.length<2)throw Error("The CSV needs a header and at least one transaction.");
  const columns=rows[0].length;
  rows.forEach((r,i)=>{if(r.length!==columns)throw Error(`CSV row ${i+1} has ${r.length} columns; the header has ${columns}. Review its separators and quotes.`);});
  return rows;
}

/** Parse currency using explicit decimal/thousands conventions and integer math. */
export function bankMoneyCents(value: string, decimalFormat: "dot"|"comma"="dot"): number {
  let clean=value.trim().replace(/^\$/,"").trim(),negative=false;
  if(clean.startsWith("(")&&clean.endsWith(")")){negative=true;clean=clean.slice(1,-1);}
  if(clean.startsWith("-")){if(negative)throw Error("The amount contains two negative signs.");negative=true;clean=clean.slice(1);}
  if(clean.startsWith("+"))clean=clean.slice(1);
  clean=clean.replace(/^\$/,"").trim();
  const pattern=decimalFormat==="dot" ? /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/ : /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/;
  if(!pattern.test(clean))throw Error("Enter an exact monetary amount using the selected decimal format, with at most two decimal places.");
  const normalized=decimalFormat==="dot" ? clean.replaceAll(",","") : clean.replaceAll(".","").replace(",",".");
  const [whole,fraction=""]=normalized.split(".");const cents=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));
  if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw Error("The amount is too large to store exactly.");
  return Number(cents)*(negative?-1:1);
}
export function csvMapping(value: unknown, width: number): CsvMapping {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Review the CSV column mapping.");
  const m=value as Record<string,unknown>;
  const index=(key:string,required:boolean)=>{const v=m[key];if(v==null&&!required)return null;if(!Number.isInteger(v)||Number(v)<0||Number(v)>=width)throw Error(`Select a valid ${key.replace('Column','')} column.`);return Number(v);};
  if(![",",";","\t"].includes(String(m.delimiter))||!["ymd","mdy","dmy"].includes(String(m.dateFormat))||!["dot","comma"].includes(String(m.decimalFormat))||!["in","out"].includes(String(m.positiveMeans)))throw Error("Choose explicit separator, date, decimal and money direction formats.");
  const result={delimiter:m.delimiter,dateColumn:index("dateColumn",true)!,descriptionColumn:index("descriptionColumn",true)!,amountColumn:index("amountColumn",false),moneyInColumn:index("moneyInColumn",false),moneyOutColumn:index("moneyOutColumn",false),dateFormat:m.dateFormat,decimalFormat:m.decimalFormat,positiveMeans:m.positiveMeans} as CsvMapping;
  if((result.amountColumn!==null)===(result.moneyInColumn!==null||result.moneyOutColumn!==null)||result.amountColumn===null&&(result.moneyInColumn===null||result.moneyOutColumn===null))throw Error("Map one signed amount column or both money-in and money-out columns.");
  const selected=[result.dateColumn,result.descriptionColumn,result.amountColumn,result.moneyInColumn,result.moneyOutColumn].filter(i=>i!==null);
  if(new Set(selected).size!==selected.length)throw Error("Each mapped field needs a separate column.");
  return result;
}
export function bankCsvRows(text: string, value: unknown): { headers: string[]; mapping: CsvMapping; rows: StatementRow[]; sourceRowNumbers: number[] } {
  const raw=value as CsvMapping;const table=parseBankCsv(text,raw?.delimiter),mapping=csvMapping(value,table[0].length);
  const rows:StatementRow[]=[],errors:string[]=[];
  table.slice(1).forEach((r,index)=>{try {
    const date=r[mapping.dateColumn].trim();let postingDate=date;
    if(mapping.dateFormat!=="ymd") {const match=/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(date);if(!match)throw Error("Use the selected month/day/year or day/month/year format.");const month=mapping.dateFormat==="mdy"?match[1]:match[2],day=mapping.dateFormat==="mdy"?match[2]:match[1];postingDate=`${match[3]}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`;}
    if(!isCalendarDate(postingDate))throw Error("Invalid date. Select the exact date format used in the file.");
    const description=r[mapping.descriptionColumn].trim().normalize("NFC").replace(/\s+/g," ");
    if(!description||description.length>300)throw Error("Description must contain 1–300 characters.");
    let amountCents:number;
    if(mapping.amountColumn!==null) amountCents=bankMoneyCents(r[mapping.amountColumn],mapping.decimalFormat)*(mapping.positiveMeans==="in"?1:-1);
    else {const incoming=r[mapping.moneyInColumn!].trim()?bankMoneyCents(r[mapping.moneyInColumn!],mapping.decimalFormat):0,outgoing=r[mapping.moneyOutColumn!].trim()?bankMoneyCents(r[mapping.moneyOutColumn!],mapping.decimalFormat):0;if(incoming<0||outgoing<0||incoming&&outgoing)throw Error("Money-in and money-out columns need positive amounts in only one column per row.");amountCents=incoming-outgoing;}
    if(!amountCents)throw Error("Zero or empty movement. Remove nontransaction rows before importing.");
    rows.push({postingDate,description,amountCents});
  }catch(e){errors.push(`Row ${index+2}: ${(e as Error).message}`);}});
  if(errors.length)throw Error(`${errors.length} CSV row${errors.length===1?"":"s"} need review. ${errors.slice(0,5).join(" ")}`);
  return {headers:table[0],mapping,rows,sourceRowNumbers:rows.map((_,i)=>i+2)};
}
export async function bankCsvInput(body: Record<string,unknown>, today:string, currency:string) {
  const fields=["action","csvText","fileName","mapping","currency","bankAccountId","newAccount","startDate","endDate","openingBalanceCents","closingBalanceCents","reviewConfirmed","previewFingerprint"];
  if(Object.keys(body).some(key=>!fields.includes(key)))throw Error("The CSV request contains an unsupported field.");
  if(body.currency!==undefined&&body.currency!==currency)throw Error("Use one statement in the BookLoQ base currency. Currency conversion is a separate reviewed workflow.");
  if(typeof body.csvText!=="string")throw Error("Choose a UTF-8 bank CSV file.");
  const parsed=bankCsvRows(body.csvText,body.mapping);
  const sourceDigest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body.csvText))),b=>b.toString(16).padStart(2,"0")).join("");
  const statement=reviewedBankStatement({...body,currency,documentId:`csv_${sourceDigest}`,rows:parsed.rows,demoRecord:false},today);
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({sourceDigest,mapping:parsed.mapping,statement})))),b=>b.toString(16).padStart(2,"0")).join("");
  const fileName=typeof body.fileName==="string" ? body.fileName.replace(/[\u0000-\u001f\u007f/\\]/g,"_").slice(0,120) : "bank.csv";
  return {statement,mapping:parsed.mapping,headers:parsed.headers,sourceDigest,fingerprint,fileName,csvText:body.csvText};
}
