import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  createSaleDeal: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 })
  ),
}));

vi.mock('@/lib/contacts/tag-events', () => ({
  addContactTagAndDispatch: mocks.add,
}));

vi.mock('@/lib/contacts/sale-tag', () => ({
  createSaleDeal: mocks.createSaleDeal,
}));

vi.mock('@/lib/contacts/tag-write', () => ({
  ContactTagWriteError: class ContactTagWriteError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  removeContactTag: mocks.remove,
}));

import { DELETE, POST } from './route';

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

function request(method: 'POST' | 'DELETE', body: unknown) {
  return new Request('http://localhost/api/contacts/contact-1/tags', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'contact-1' }) };

/** Minimal `.from(table).select().eq().maybeSingle()` stub keyed by table. */
function fakeDb(rows: Record<string, unknown>) {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: rows[table] ?? null, error: null }),
          }),
        }),
      };
    },
  };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.add.mockReset();
  mocks.remove.mockReset();
  mocks.createSaleDeal.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('/api/contacts/[id]/tags', () => {
  it('requires an agent and dispatches a newly-added tag', async () => {
    mocks.add.mockResolvedValue({ added: true, dispatched: true });

    const response = await POST(request('POST', { tag_id: 'tag-1' }), params);

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
    expect(mocks.add).toHaveBeenCalledWith({
      db: context.supabase,
      accountId: 'account-1',
      contactId: 'contact-1',
      tagId: 'tag-1',
    });
  });

  it('rejects a missing tag id before writing', async () => {
    const response = await POST(request('POST', {}), params);
    expect(response.status).toBe(400);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('removes a tag through the same account-scoped route', async () => {
    mocks.remove.mockResolvedValue(undefined);

    const response = await DELETE(
      request('DELETE', { tag_id: 'tag-1' }),
      params
    );

    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(context.supabase, {
      accountId: 'account-1',
      contactId: 'contact-1',
      tagId: 'tag-1',
    });
  });
});

describe('/api/contacts/[id]/tags — sale tags (migration 045)', () => {
  it('creates a deal when a sale tag is freshly added with a price', async () => {
    const db = fakeDb({
      tags: { name: 'Venta', is_sale_tag: true },
      accounts: { default_currency: 'PEN' },
    });
    mocks.requireRole.mockResolvedValue({ ...context, supabase: db });
    mocks.add.mockResolvedValue({ added: true, dispatched: true });
    mocks.createSaleDeal.mockResolvedValue({ id: 'deal-1' });

    const response = await POST(
      request('POST', { tag_id: 'tag-1', price: 147.9 }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createSaleDeal).toHaveBeenCalledWith(db, {
      accountId: 'account-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 147.9,
      currency: 'PEN',
    });
    expect(body.dealId).toBe('deal-1');
  });

  it('does not create a deal for a non-sale tag, even with a price', async () => {
    const db = fakeDb({ tags: { name: 'Interesado', is_sale_tag: false } });
    mocks.requireRole.mockResolvedValue({ ...context, supabase: db });
    mocks.add.mockResolvedValue({ added: true, dispatched: true });

    const response = await POST(
      request('POST', { tag_id: 'tag-2', price: 50 }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createSaleDeal).not.toHaveBeenCalled();
    expect(body.dealId).toBeNull();
  });

  it('does not create a deal when the tag was already on the contact (duplicate)', async () => {
    const db = fakeDb({ tags: { name: 'Venta', is_sale_tag: true } });
    mocks.requireRole.mockResolvedValue({ ...context, supabase: db });
    mocks.add.mockResolvedValue({
      added: false,
      dispatched: false,
      reason: 'duplicate',
    });

    const response = await POST(
      request('POST', { tag_id: 'tag-1', price: 147.9 }),
      params,
    );

    expect(response.status).toBe(200);
    expect(mocks.createSaleDeal).not.toHaveBeenCalled();
  });

  it('does not create a deal when no price was sent, even for a sale tag', async () => {
    mocks.add.mockResolvedValue({ added: true, dispatched: true });

    const response = await POST(request('POST', { tag_id: 'tag-1' }), params);

    expect(response.status).toBe(200);
    expect(mocks.createSaleDeal).not.toHaveBeenCalled();
  });
});
