import path from "node:path";
import { pathToFileURL } from "node:url";
import { openDb, type Db } from "./db.js";

interface SeedResult {
  companies: number;
  postings: number;
}

const CONTEXT_NOTE = `# Job search context

## Target roles
- Senior backend engineer roles (TypeScript, Node.js, Fastify) in EU remote-first teams
- Open to staff-level roles with a strong API/data focus

## Preferences
- Fully remote or hybrid within commuting distance of Vienna
- Min. 75k EUR gross, no on-call-heavy environments

## Current strategy
- Two tailor-made applications per week, prioritizing referrals
- Follow up once after 7 days of silence, then move the posting to ghosted
- Keep interview notes in each posting's AI context so follow-ups stay in sync`;

interface SeedCompany {
  name: string;
  website: string | null;
  location: string | null;
  description: string;
  aiContext: string;
}

const COMPANIES: SeedCompany[] = [
  {
    name: "Acme Robotics",
    website: "https://acme-robotics.example",
    location: "Munich, Germany",
    description: "Industrial robotics manufacturer, mid-size, hires backend engineers regularly.",
    aiContext: "Recruiter Jane Doe; prefers email follow-ups, response time ~3 days.",
  },
  {
    name: "Globex Labs",
    website: "https://globex-labs.example",
    location: "Berlin, Germany",
    description: "Biotech startup building lab automation software, remote-first.",
    aiContext: "",
  },
  {
    name: "Initech",
    website: "https://initech.example",
    location: "Vienna, Austria",
    description: "Office software vendor, slow hiring process but stable products.",
    aiContext: "Applied via referral from a former colleague.",
  },
  {
    name: "Umbrella Health",
    website: "https://umbrella-health.example",
    location: "Hamburg, Germany",
    description: "Health insurance platform, strong data engineering culture.",
    aiContext: "Their API platform team is growing; ask for the platform lead in interviews.",
  },
  {
    name: "Stark Mobility",
    website: null,
    location: "Lisbon, Portugal",
    description: "E-mobility charging network operator, Series C, hybrid.",
    aiContext: "",
  },
  {
    name: "Wayne Analytics",
    website: "https://wayne-analytics.example",
    location: "Remote (EU)",
    description: "Analytics consultancy for financial data, contract-first APIs.",
    aiContext: "Founder hires directly, no recruiters involved.",
  },
];

interface SeedPosting {
  companyIndex: number;
  title: string;
  state: string;
  /** Days ago the application was submitted; null when never applied. */
  appliedDaysAgo: number | null;
  description: string;
  aiContext: string;
  urls: string[];
}

const POSTINGS: SeedPosting[] = [
  {
    companyIndex: 0, // Acme Robotics — 4 postings
    title: "Senior Backend Engineer",
    state: "offer",
    appliedDaysAgo: 52,
    description: "Node.js services for robot fleet telemetry. 90k EUR, hybrid Munich.",
    aiContext: "Offer arrived via email from Jane Doe; contract review pending, salary slightly below target.",
    urls: ["https://acme-robotics.example/careers/senior-backend", "https://acme-robotics.example/jobs/123"],
  },
  {
    companyIndex: 0,
    title: "Platform Engineer",
    state: "rejected",
    appliedDaysAgo: 41,
    description: "Kubernetes and CI platform for the robotics cloud. Rejected after screening call.",
    aiContext: "",
    urls: ["https://acme-robotics.example/careers/platform-engineer"],
  },
  {
    companyIndex: 0,
    title: "Engineering Manager, Cloud",
    state: "withdrawn",
    appliedDaysAgo: 48,
    description: "Lead a team of six on the fleet cloud backend. Withdrew after the offer from the backend role.",
    aiContext: "",
    urls: [],
  },
  {
    companyIndex: 0,
    title: "API Developer (Contract)",
    state: "ghosted",
    appliedDaysAgo: 58,
    description: "Six-month contract to build a partner REST API. No response after two weeks.",
    aiContext: "",
    urls: [],
  },
  {
    companyIndex: 1, // Globex Labs
    title: "Backend Engineer (Lab Automation)",
    state: "interview",
    appliedDaysAgo: 12,
    description: "Python/TypeScript services connecting lab instruments to cloud queues.",
    aiContext: "Second round scheduled; team lead Petra wants a small API design exercise.",
    urls: ["https://globex-labs.example/join/backend-engineer"],
  },
  {
    companyIndex: 1,
    title: "Data Pipeline Engineer",
    state: "saved",
    appliedDaysAgo: null,
    description: "Built ingestion pipelines for sequencing data. Interesting, but heavy on Python.",
    aiContext: "",
    urls: ["https://globex-labs.example/join/data-pipeline-engineer"],
  },
  {
    companyIndex: 2, // Initech
    title: "Full Stack Developer",
    state: "screening",
    appliedDaysAgo: 8,
    description: "React + Node on their document product. Asked for availability for a recruiter screen.",
    aiContext: "",
    urls: ["https://initech.example/careers/231"],
  },
  {
    companyIndex: 2,
    title: "Backend Developer",
    state: "applied",
    appliedDaysAgo: 3,
    description: "Java-to-Node migration project. Applied through the referral link.",
    aiContext: "Referral submitted the CV directly; expect contact within a week.",
    urls: [],
  },
  {
    companyIndex: 3, // Umbrella Health
    title: "Staff API Engineer",
    state: "screening",
    appliedDaysAgo: 15,
    description: "Own the public FHIR-based API platform. Strong process focus.",
    aiContext: "Screening call on Tuesday; mention the platform leaderboard work.",
    urls: ["https://umbrella-health.example/careers/staff-api-engineer", "https://umbrella-health.example/engineering-blog"],
  },
  {
    companyIndex: 3,
    title: "Backend Engineer (Integrations)",
    state: "applied",
    appliedDaysAgo: 19,
    description: "Integrate payer partners via HL7 and REST. Applied via their ATS.",
    aiContext: "",
    urls: [],
  },
  {
    companyIndex: 4, // Stark Mobility
    title: "Senior Node Engineer",
    state: "applied",
    appliedDaysAgo: 25,
    description: "Charging-session billing APIs in Node and Postgres. Hybrid Lisbon.",
    aiContext: "",
    urls: ["https://stark-mobility.jobs/node-engineer"],
  },
  {
    companyIndex: 4,
    title: "Tech Lead, Charging Platform",
    state: "interview",
    appliedDaysAgo: 22,
    description: "Lead the charging platform team, hands-on with TypeScript.",
    aiContext: "Liked my distributed-systems talk; next step is a system design session.",
    urls: [],
  },
  {
    companyIndex: 5, // Wayne Analytics
    title: "Backend Consultant",
    state: "rejected",
    appliedDaysAgo: 34,
    description: "Client-facing Node/TypeScript consulting. Rejected: they wanted more finance domain experience.",
    aiContext: "",
    urls: ["https://wayne-analytics.example/jobs/backend-consultant"],
  },
  {
    companyIndex: 5,
    title: "API Platform Lead",
    state: "saved",
    appliedDaysAgo: null,
    description: "Recently posted leadership-lite role. Waiting until the Acme offer is resolved.",
    aiContext: "Gather salary intel first; the founder answers email directly.",
    urls: [],
  },
];

export function seedDatabase(db: Db, now = new Date()): SeedResult {
  const insertCompany = db.prepare(
    `INSERT INTO companies (name, website, location, description, ai_context, urls)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertPosting = db.prepare(
    `INSERT INTO postings (company_id, title, state, applied_date, description, ai_context, urls)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const companyCount = db.prepare("SELECT COUNT(*) as count FROM companies").get() as { count: number };
  const postingCount = db.prepare("SELECT COUNT(*) as count FROM postings").get() as { count: number };

  if (companyCount.count > 0 || postingCount.count > 0) {
    process.stderr.write(
      "Database is not empty. Re-run with --reset to wipe companies, postings and the context note first.\n",
    );
    process.exit(1);
  }

  const run = db.transaction(() => {
    const companyIds: number[] = [];
    for (const company of COMPANIES) {
      const result = insertCompany.run(
        company.name,
        company.website,
        company.location,
        company.description,
        company.aiContext,
        JSON.stringify([]),
      );
      companyIds.push(Number(result.lastInsertRowid));
    }

    for (const posting of POSTINGS) {
      let appliedDate: string | null = null;
      if (posting.appliedDaysAgo !== null) {
        const date = new Date(now);
        date.setDate(date.getDate() - posting.appliedDaysAgo);
        appliedDate = date.toISOString().slice(0, 10);
      }
      insertPosting.run(
        companyIds[posting.companyIndex],
        posting.title,
        posting.state,
        appliedDate,
        posting.description,
        posting.aiContext,
        JSON.stringify(posting.urls),
      );
    }

    // ContextNote
    db.prepare("UPDATE context SET content = ? WHERE id = 1").run(CONTEXT_NOTE);
  });
  run();

  return {
    companies: COMPANIES.length,
    postings: POSTINGS.length,
  };
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const reset = process.argv.includes("--reset");
  const db = openDb();

  if (reset) {
    db.transaction(() => {
      db.prepare("DELETE FROM postings").run();
      db.prepare("DELETE FROM companies").run();
      db.prepare("UPDATE context SET content = '' WHERE id = 1").run();
    })();
    process.stdout.write("Reset complete.\n");
  }

  const result = seedDatabase(db);
  process.stdout.write(`Seeded ${result.companies} companies and ${result.postings} postings.\n`);
  db.close();
}
