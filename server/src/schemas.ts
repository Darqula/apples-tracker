export const STATES = ['saved', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn', 'ghosted'] as const;

export type State = (typeof STATES)[number];

export const STAGE_ORDER: readonly State[] = [
  'offer',
  'interview',
  'screening',
  'applied',
  'saved',
  'rejected',
  'withdrawn',
  'ghosted',
];

const urlString = {
  type: 'string',
  pattern: '^https?://',
  description: 'Full http(s) link',
} as const;

const nonEmptyString = { type: 'string', minLength: 1 } as const;

const nullableString = { type: ['string', 'null'] } as const;

export const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', description: 'Machine-readable error code, e.g. VALIDATION, NOT_FOUND, CONFLICT' },
        message: { type: 'string', description: 'Human-readable error message' },
      },
    },
  },
} as const;

const stateDescription = `Application state. One of:
- saved: bookmarked, not yet applied
- applied: application submitted
- screening: recruiter screening stage
- interview: in interview process
- offer: offer received
- rejected: application rejected
- withdrawn: application withdrawn
- ghosted: no response from the company`;

export const companyCreateSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { ...nonEmptyString, description: 'Company name. Unique, compared case-insensitively.' },
    website: { ...nullableString, description: 'Company website as a full http(s) link, or null' },
    location: { ...nullableString, description: 'Company location (e.g. city, country), or null' },
    description: { type: 'string', description: 'General notes about the company, shown in tables' },
    aiContext: { type: 'string', description: 'Notes for AI models about the company; not shown in tables' },
    urls: { type: 'array', items: urlString, description: 'Full http(s) links related to the company' },
  },
  examples: [
    {
      name: 'Acme Robotics',
      website: 'https://acme.example',
      location: 'Berlin, Germany',
      description: 'Industrial robotics manufacturer, mid-size, hires regularly.',
      aiContext: 'Recruiter Jane Doe; prefers email follow-ups, response time ~3 days.',
      urls: ['https://acme.example/careers'],
    },
  ],
} as const;

export const companyPatchSchema = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    name: { ...nonEmptyString, description: 'Company name. Unique, compared case-insensitively.' },
    website: { ...nullableString, description: 'Company website as a full http(s) link, or null' },
    location: { ...nullableString, description: 'Company location (e.g. city, country), or null' },
    description: { type: 'string', description: 'General notes about the company, shown in tables' },
    aiContext: { type: 'string', description: 'Notes for AI models about the company; not shown in tables' },
    urls: { type: 'array', items: urlString, description: 'Full http(s) links related to the company' },
  },
} as const;

export const idParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'integer', minimum: 1, description: 'Company or posting id (positive integer)' },
  },
} as const;

export const companyResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    website: { type: ['string', 'null'] },
    location: { type: ['string', 'null'] },
    description: { type: 'string' },
    aiContext: { type: 'string' },
    urls: { type: 'array', items: { type: 'string' } },
    postingCount: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

export const companyDetailResponseSchema = {
  type: 'object',
  properties: {
    ...companyResponseSchema.properties,
    postings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          state: { type: 'string' },
          appliedDate: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

export const postingCreateSchema = {
  type: 'object',
  additionalProperties: false,
  oneOf: [
    { required: ['companyId'], not: { required: ['companyName'] } },
    { required: ['companyName'], not: { required: ['companyId'] } },
  ],
  properties: {
    companyId: { type: 'integer', minimum: 1, description: 'Id of an existing company; mutually exclusive with companyName' },
    companyName: {
      ...nonEmptyString,
      description: 'Name of the company to attach the posting to; the company is created if it does not exist. Mutually exclusive with companyId',
    },
    title: { ...nonEmptyString, description: 'Job title' },
    state: { type: 'string', enum: [...STATES], default: 'saved', description: stateDescription },
    appliedDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date the application was submitted, ISO YYYY-MM-DD, or null' },
    description: { type: 'string', description: 'Job description / role details, shown in tables' },
    aiContext: { type: 'string', description: 'Notes for AI models about the posting; not shown in tables' },
    urls: { type: 'array', items: urlString, description: 'Full http(s) links related to the posting' },
  },
  examples: [
    {
      companyName: 'Acme Robotics',
      title: 'Senior Backend Engineer',
      state: 'applied',
      appliedDate: '2026-09-21',
      description: 'Own the data intake pipeline. Python, PostgreSQL.',
      aiContext: 'Found via Jane Doe; salary range 70-90k EUR, remote-friendly.',
      urls: ['https://jobs.acme.example/senior-backend-engineer'],
    },
  ],
} as const;

export const postingPatchSchema = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    companyId: { type: 'integer', minimum: 1, description: 'Move the posting to this existing company' },
    title: { ...nonEmptyString, description: 'Job title' },
    state: { type: 'string', enum: [...STATES], description: stateDescription },
    appliedDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date the application was submitted, ISO YYYY-MM-DD, or null' },
    description: { type: 'string', description: 'Job description / role details, shown in tables' },
    aiContext: { type: 'string', description: 'Notes for AI models about the posting; not shown in tables' },
    urls: { type: 'array', items: urlString, description: 'Full http(s) links related to the posting' },
  },
} as const;

export const postingResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    companyId: { type: 'integer' },
    company: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
      },
    },
    title: { type: 'string' },
    state: { type: 'string' },
    appliedDate: { type: ['string', 'null'] },
    description: { type: 'string' },
    aiContext: { type: 'string' },
    urls: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

export const postingListQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: {
      type: 'string',
      description: 'Search filter. Case-insensitive substring match against the job title and the company name only — never the description or aiContext',
    },
    state: { type: 'string', enum: [...STATES], description: `Only return postings in this state. One of: ${STATES.join(', ')}` },
    companyId: { type: 'integer', minimum: 1, description: 'Only return postings of the company with this id' },
    sort: {
      type: 'string',
      enum: ['stage', 'company', 'applied', '-applied', 'title', 'updated'],
      description: `Sort order. 'stage' = most advanced stage first (offer, interview, screening, applied, saved, rejected, withdrawn, ghosted); 'company' = company name A→Z; 'applied' = applied date newest first; '-applied' = oldest first; 'title' = job title A→Z; 'updated' = most recently updated first`,
    },
    limit: { type: 'integer', minimum: 1, maximum: 2000, default: 500, description: 'Maximum number of postings to return (1–2000). Default 500' },
    offset: { type: 'integer', minimum: 0, description: 'Number of postings to skip; use for paging' },
  },
} as const;

export const contextResponseSchema = {
  type: 'object',
  required: ['content', 'updatedAt'],
  properties: {
    content: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

export const contextPutBodySchema = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: {
    content: { type: 'string', maxLength: 100000, description: 'The one shared context note (shown to AI models). Max 100000 characters' },
    expectedUpdatedAt: {
      type: 'string',
      description: 'Optimistic-concurrency guard: pass the updatedAt value from the last GET /api/context; the write fails with 409 if it no longer matches',
    },
  },
} as const;

export const companyListQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: {
      type: 'string',
      description: 'Search filter. Case-insensitive substring match against the company name only',
    },
    sort: {
      type: 'string',
      enum: ['name', '-name', 'created', '-created'],
      description: "Sort order. 'name' = company name A→Z; '-name' = Z→A; 'created' = oldest first; '-created' = newest first",
    },
    limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Maximum number of companies to return (1–1000). Default 200' },
    offset: { type: 'integer', minimum: 0, description: 'Number of companies to skip; use for paging' },
  },
} as const;

export const companyDeleteQuerySchema = {
  type: 'object',
  properties: {
    cascade: {
      type: 'string',
      enum: ['true', 'false'],
      description: "Set 'true' to also delete the company's postings; 'false' (default) refuses with 409 when the company still has postings",
    },
  },
} as const;
