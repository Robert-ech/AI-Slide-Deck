import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildFinancials } from "../src/lib/financials";
import type { CompanyFacts, Submissions } from "../src/lib/sec";

async function main() {
  const { values } = parseArgs({ options: {
    cik: { type: "string" }, facts: { type: "string" }, submissions: { type: "string" },
    out: { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("npm run calculate -- --cik 0000001234 --facts examples/companyfacts.json --submissions examples/submissions.json [--out output/result.json]");
    return;
  }
  if (!values.cik || !/^\d{1,10}$/.test(values.cik) || Number(values.cik) === 0 || !values.facts || !values.submissions) {
    throw new Error("Provide --cik, --facts, and --submissions. Run npm run calculate -- --help for usage.");
  }
  const [factsText, submissionsText] = await Promise.all([
    readFile(values.facts, "utf8"), readFile(values.submissions, "utf8"),
  ]);
  const facts = JSON.parse(factsText) as CompanyFacts;
  const submissions = JSON.parse(submissionsText) as Submissions;
  if (Number(facts.cik) !== Number(values.cik) || !facts.facts || typeof facts.facts !== "object") {
    throw new Error("The companyfacts JSON must match the supplied CIK and contain the SEC facts object.");
  }
  if (submissions.cik && Number(submissions.cik) !== Number(values.cik)) {
    throw new Error("The submissions JSON CIK does not match the supplied company.");
  }
  if (!Array.isArray(submissions.filings?.recent?.accessionNumber) || !Array.isArray(submissions.filings?.recent?.primaryDocument)) {
    throw new Error("The submissions JSON must contain filings.recent.accessionNumber and primaryDocument arrays.");
  }
  const result = buildFinancials(values.cik.padStart(10, "0"), facts, submissions);
  const json = JSON.stringify(result, null, 2) + "\n";
  if (values.out) {
    const output = resolve(values.out);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, json);
    console.log(`Calculation output saved to ${values.out}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Calculation failed.");
  process.exitCode = 1;
});
