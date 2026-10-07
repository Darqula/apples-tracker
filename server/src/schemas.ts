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

const listIdsProperty = {
  type: 'array',
  items: { type: 'integer', minimum: 1 },
  description: 'Ids of the lists the item belongs to. On update this REPLACES the whole set ([] removes the item from all lists); omit it to leave memberships unchanged',
} as const;

const listRefsProperty = {
  type: 'array',
  description: 'Lists the item belongs to, sorted by name',
  items: {
    type: 'object',
    properties: { id: { type: 'integer' }, name: { type: 'string' } },
  },
} as const;

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
    listIds: listIdsProperty,
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
    listIds: listIdsProperty,
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
    lists: listRefsProperty,
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
    listIds: listIdsProperty,
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
    listIds: listIdsProperty,
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
    lists: listRefsProperty,
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
    listId: { type: 'integer', minimum: 1, description: 'Only return items that belong to the list with this id' },
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
  required: ['content', 'expectedUpdatedAt'],
  additionalProperties: false,
  properties: {
    content: { type: 'string', maxLength: 100000, description: 'The one shared context note (shown to AI models). Max 100000 characters' },
    expectedUpdatedAt: {
      type: 'string',
      description: 'Required optimistic-concurrency guard: pass the updatedAt value from the last GET /api/context; the write fails with 409 if it no longer matches',
    },
    force: {
      type: 'boolean',
      description: 'Bypass the shrink guard (422 SHRINK_GUARD); set only after the user explicitly confirmed a large reduction',
    },
  },
} as const;

export const contextHistoryListResponseSchema = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      description: 'Earlier versions of the note, newest first. Content is omitted; fetch a version by id',
      items: {
        type: 'object',
        required: ['id', 'updatedAt', 'replacedAt', 'length'],
        properties: {
          id: { type: 'integer' },
          updatedAt: { type: 'string', description: 'When this version was written' },
          replacedAt: { type: 'string', description: 'When this version was overwritten' },
          length: { type: 'integer', description: 'Content length in characters' },
        },
      },
    },
  },
} as const;

export const contextHistoryEntrySchema = {
  type: 'object',
  required: ['id', 'content', 'updatedAt', 'replacedAt'],
  properties: {
    id: { type: 'integer' },
    content: { type: 'string' },
    updatedAt: { type: 'string', description: 'When this version was written' },
    replacedAt: { type: 'string', description: 'When this version was overwritten' },
  },
} as const;

export const contextHistoryParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'integer', minimum: 1, description: 'Context history version id (positive integer)' },
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
    listId: { type: 'integer', minimum: 1, description: 'Only return items that belong to the list with this id' },
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

export const listCreateSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { ...nonEmptyString, description: 'List name. Unique among lists of the same kind, compared case-insensitively.' },
  },
  examples: [{ name: 'Never consider' }],
} as const;

export const listResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    memberCount: { type: 'integer', description: 'Number of items currently in the list' },
    createdAt: { type: 'string' },
  },
} as const;
