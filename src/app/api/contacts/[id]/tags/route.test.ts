import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  createSale: vi.fn(),
  pushSetRegion: vi.fn(),
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
  createSale: mocks.createSale,
}));

vi.mock('@/lib/contacts/sale-sheet', () => ({
  pushSetRegion: mocks.pushSetRegion,
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

/** Minimal `.from(table).select().eq().maybeSingle()` stub keyed by table.
 *  Every POST now looks up the tag (for `region_value`) as soon as it's
 *  freshly added, regardless of price, so every context needs a usable
 *  `.from()` even in tests that aren't about sale tags. */
function fakeDb(rows: Record<string, unknown>) {
  return {
    name: 'scoped-client',
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

const context = {
  supabase: fakeDb({}),
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

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.add.mockReset();
  mocks.remove.mockReset();
  mocks.createSale.mockReset();
  mocks.pushSetRegion.mockReset();
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
  it('creates a sale when a sale tag is freshly added with a price', async () => {
    const db = fakeDb({
      tags: { name: 'Venta', is_sale_tag: true },
      accounts: { default_currency: 'PEN' },
    });
    mocks.requireRole.mockResolvedValue({ ...context, supabase: db });
    mocks.add.mockResolvedValue({ added: true, dispatched: true });
    mocks.createSale.mockResolvedValue({ id: 'sale-1' });

    const response = await POST(
      request('POST', { tag_id: 'tag-1', price: 147.9 }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createSale).toHaveBeenCalledWith(db, {
      accountId: 'account-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 147.9,
      currency: 'PEN',
    });
    expect(body.saleId).toBe('sale-1');
  });

  it('does not create a sale for a non-sale tag, even with a price', async () => {
    const db = fakeDb({ tags: { name: 'Interesado', is_sale_tag: false } });
    mocks.requireRole.mockResolvedValue({ ...context, supabase: db });
    mocks.add.mockResolvedValue({ added: true, dispatched: true });

    const response = await POST(
      request('POST', { tag_id: 'tag-2', price: 50 }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createSale).not.toHaveBeenCalled();
    expect(body.saleId).toBeNull();
  });

  it('does not create a sale when the tag was already on the contact (duplicate)', async () => {
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
    expect(mocks.createSale).not.toHaveBeenCalled();
  });

  it('does not create a sale when no price was sent, even for a sale tag', async () => {
    mocks.add.mockResolvedValue({ added: true, dispatched: true });

    const response = await POST(request('POST', { tag_id: 'tag-1' }), params);

    expect(response.status).toBe(200);
    expect(mocks.createSale).not.toHaveBeenCalled();
  });

  it('passes fecha through to createSale when the caller sent one', async () => {
    const db = fakeDb({
      tags: { name: 'Venta', is_sale_tag: true },
      accounts: { default_currency: 'PEN' },
    });
    mocks.requireRole.mockResolvedValue({ ...context, supabase: db });
    mocks.add.mockResolvedValue({ added: true, dispatched: true });
    mocks.createSale.mockResolvedValue({ id: 'sale-1' });

    await POST(
      request('POST', { tag_id: 'tag-1', price: 147.9, fecha: '2026-09-15' }),
      params,
    );

    expect(mocks.createSale).toHaveBeenCalledWith(db, {
      accountId: 'account-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 147.9,
      currency: 'PEN',
      fecha: '2026-09-15',
    });
  });
});

describe('/api/contacts/[id]/tags — region tags (migration 050)', () => {
  it('pushes the contact\'s phone + region when a region tag is freshly added', async () => {
    const db = fakeDb({
      tags: { name: 'Lima', is_sale_tag: false, region_value: 'Lima' },
      contacts: { phone: '51999999999' },
    });
    mocks.requireRole.mockResolvedValue({ ...context, supabase: db });
    mocks.add.mockResolvedValue({ added: true, dispatched: true });

    await POST(request('POST', { tag_id: 'tag-3' }), params);

    expect(mocks.pushSetRegion).toHaveBeenCalledWith(db, 'account-1', {
      telefono: '51999999999',
      ciudad: 'Lima',
    });
    expect(mocks.createSale).not.toHaveBeenCalled();
  });

  it('does not push a region for a tag with no region_value', async () => {
    const db = fakeDb({ tags: { name: 'Interesado', is_sale_tag: false } });
    mocks.requireRole.mockResolvedValue({ ...context, supabase: db });
    mocks.add.mockResolvedValue({ added: true, dispatched: true });

    await POST(request('POST', { tag_id: 'tag-2' }), params);

    expect(mocks.pushSetRegion).not.toHaveBeenCalled();
  });

  it('does not push a region on a duplicate re-tag', async () => {
    const db = fakeDb({ tags: { name: 'Lima', is_sale_tag: false, region_value: 'Lima' } });
    mocks.requireRole.mockResolvedValue({ ...context, supabase: db });
    mocks.add.mockResolvedValue({ added: false, dispatched: false, reason: 'duplicate' });

    await POST(request('POST', { tag_id: 'tag-3' }), params);

    expect(mocks.pushSetRegion).not.toHaveBeenCalled();
  });
});
