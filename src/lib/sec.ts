const SEC_DATA = "https://data.sec.gov";
const SEC_WEB = "https://www.sec.gov";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type Company = { ticker: string; name: string; cik: string };
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

let lastSecRequest = 0;
async function secFetch<T>(url: string): Promise<T> {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (!userAgent || userAgent.includes("your-email@example.com")) {
    throw new Error("Set SEC_USER_AGENT in .env.local to your project name and contact email before using SEC data.");
  }
  const wait = Math.max(0, 175 - (Date.now() - lastSecRequest));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastSecRequest = Date.now();
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error(`SEC request failed (${response.status}). Try again later or check SEC_USER_AGENT.`);
  return (await response.json()) as T;
}

let companiesCache: { at: number; companies: Company[] } | undefined;
const PILOTS: Company[] = [
  { ticker: "WMT", name: "Walmart Inc.", cik: "0000104169" },
  { ticker: "MSFT", name: "Microsoft Corporation", cik: "0000789019" },
];
export async function getCompanies(): Promise<Company[]> {
  if (companiesCache && Date.now() - companiesCache.at < 24 * 60 * 60 * 1000) return companiesCache.companies;
  if (!process.env.SEC_USER_AGENT) return PILOTS;
  try {
    const raw = await secFetch<Record<string, { cik_str: number; ticker: string; title: string }>>(
      `${SEC_WEB}/files/company_tickers.json`,
    );
    const companies = Object.values(raw).map((row) => ({
      ticker: row.ticker.toUpperCase(),
      name: row.title,
      cik: String(row.cik_str).padStart(10, "0"),
    }));
    companiesCache = { at: Date.now(), companies };
    return companies;
  } catch {
    // The pilot picker remains usable when the SEC rejects requests from this network.
    return PILOTS;
  }
}

export async function findCompany(ticker: string): Promise<Company> {
  const company = (await getCompanies()).find((item) => item.ticker === ticker.toUpperCase());
  if (!company) throw new Error(`Ticker ${ticker.toUpperCase()} was not found in the SEC company list.`);
  return company;
}

export async function getSecBundle(ticker: string): Promise<{
  company: Company;
  facts: CompanyFacts;
  submissions: Submissions;
}> {
  const upper = ticker.toUpperCase();
  const pilot = PILOTS.find((item) => item.ticker === upper);
  if (pilot) {
    try {
      const directory = path.join(process.cwd(), "data", "sec");
      const [factsText, submissionsText] = await Promise.all([
        readFile(path.join(directory, `${upper}-facts.json`), "utf8"),
        readFile(path.join(directory, `${upper}-submissions.json`), "utf8"),
      ]);
      const facts = JSON.parse(factsText) as CompanyFacts;
      const submissions = JSON.parse(submissionsText) as Submissions;
      if (Number(pilot.cik) !== facts.cik) throw new Error("Local SEC facts do not match the selected pilot company.");
      return { company: pilot, facts, submissions };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const company = await findCompany(ticker);
  const [facts, submissions] = await Promise.all([
    secFetch<CompanyFacts>(`${SEC_DATA}/api/xbrl/companyfacts/CIK${company.cik}.json`),
    secFetch<Submissions>(`${SEC_DATA}/submissions/CIK${company.cik}.json`),
  ]);
  return { company, facts, submissions };
}

export function filingUrl(cik: string, accession: string, submissions: Submissions): string {
  const index = submissions.filings.recent.accessionNumber.indexOf(accession);
  const doc = index >= 0 ? submissions.filings.recent.primaryDocument[index] : undefined;
  const base = `${SEC_WEB}/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/`;
  return doc ? `${base}${doc}` : `${base}${accession}-index.htm`;
}
