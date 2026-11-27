// Standalone SEC shapes and source-link helper. No retrieval or API calls.
const SEC_WEB = "https://www.sec.gov";

export type XbrlEntry = {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
};
export type CompanyFacts = {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { label: string; units: Record<string, XbrlEntry[]> }>>;
};
export type Submissions = {
  cik?: string;
  name: string;
  description?: string;
  sicDescription?: string;
  filings: { recent: { accessionNumber: string[]; primaryDocument: string[] } };
};

export function filingUrl(cik: string, accession: string, submissions: Submissions): string {
  const index = submissions.filings.recent.accessionNumber.indexOf(accession);
  const doc = index >= 0 ? submissions.filings.recent.primaryDocument[index] : undefined;
  const base = `${SEC_WEB}/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/`;
  return doc ? `${base}${doc}` : `${base}${accession}-index.htm`;
}
