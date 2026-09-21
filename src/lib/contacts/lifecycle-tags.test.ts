import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  addContactTagAndDispatch: vi.fn(),
  removeContactTag: vi.fn(),
}));

vi.mock('./tag-events', () => ({
  addContactTagAndDispatch: h.addContactTagAndDispatch,
}));
vi.mock('./tag-write', () => ({
  removeContactTag: h.removeContactTag,
}));

import {
  applyPotentialTag,
  clearLifecycleTagsOnSale,
  clearDroppedTagOnReactivation,
} from './lifecycle-tags';

interface FakeState {
  /** tag_id rows already on the contact. */
  contactTags: string[];
  /** tags.id of any tag with is_sale_tag=true, on the account. */
  saleTagIds: string[];
  /** tags.id of any tag with is_potential_tag=true, on the account. */
  potentialTagIds: string[];
  /** tags.id of any tag with is_potential_tag OR is_dropped_tag=true (the `.or(...)` lookup). */
  flaggedTagIds: string[];
}

/** A single chain object that's both further-chainable and thenable —
 *  every builder method mutates `mode` and returns `this`; the
 *  terminal `.then()`/`.maybeSingle()` reads `mode` to decide which
 *  fixture list to resolve with. Good enough to exercise
 *  lifecycle-tags.ts's exact call shapes without a real PostgREST
 *  round-trip. */
function fakeDb(state: FakeState): SupabaseClient {
  return {
    from(table: string) {
      let mode: 'sale' | 'potential' | 'flagged' | 'contact-tags' = 'contact-tags';
      const resolveArray = (): { id?: string; tag_id?: string }[] => {
        if (table === 'contact_tags') {
          return state.contactTags.map((tag_id) => ({ tag_id }));
        }
        if (mode === 'sale') return state.saleTagIds.map((id) => ({ id }));
        if (mode === 'potential') return state.potentialTagIds.map((id) => ({ id }));
        return state.flaggedTagIds.map((id) => ({ id }));
      };
      const chain = {
        select: () => chain,
        eq(field: string, value: unknown) {
          if (field === 'is_sale_tag' && value === true) mode = 'sale';
          if (field === 'is_potential_tag' && value === true) mode = 'potential';
          return chain;
        },
        in: () => chain,
        limit: () => chain,
        or: () => {
          mode = 'flagged';
          return chain;
        },
        maybeSingle: () => {
          const rows = resolveArray();
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          return resolve({ data: resolveArray(), error: null });
        },
      };
      return chain as unknown as ReturnType<SupabaseClient['from']>;
    },
  } as unknown as SupabaseClient;
}

const accountId = 'account-1';
const contactId = 'contact-1';

beforeEach(() => {
  h.addContactTagAndDispatch.mockReset();
  h.removeContactTag.mockReset();
});

describe('applyPotentialTag', () => {
  it('skips a contact that already has a sale tag', async () => {
    const db = fakeDb({
      contactTags: ['tag-sale'],
      saleTagIds: ['tag-sale'],
      potentialTagIds: ['tag-potencial'],
      flaggedTagIds: [],
    });

    await applyPotentialTag(db, accountId, contactId);

    expect(h.addContactTagAndDispatch).not.toHaveBeenCalled();
  });

  it('adds every configured Potencial tag when the contact has none of them yet', async () => {
    const db = fakeDb({
      contactTags: [],
      saleTagIds: [],
      potentialTagIds: ['tag-potencial'],
      flaggedTagIds: [],
    });

    await applyPotentialTag(db, accountId, contactId);

    expect(h.addContactTagAndDispatch).toHaveBeenCalledWith({
      db,
      accountId,
      contactId,
      tagId: 'tag-potencial',
    });
  });

  it('no-ops when the account has not configured a Potencial tag', async () => {
    const db = fakeDb({
      contactTags: [],
      saleTagIds: [],
      potentialTagIds: [],
      flaggedTagIds: [],
    });

    await applyPotentialTag(db, accountId, contactId);

    expect(h.addContactTagAndDispatch).not.toHaveBeenCalled();
  });

  it('never throws when the db call fails', async () => {
    const db = {
      from() {
        throw new Error('boom');
      },
    } as unknown as SupabaseClient;

    await expect(applyPotentialTag(db, accountId, contactId)).resolves.toBeUndefined();
  });
});

describe('clearLifecycleTagsOnSale / clearDroppedTagOnReactivation', () => {
  it('removes every matching lifecycle tag the contact has', async () => {
    const db = fakeDb({
      contactTags: ['tag-potencial', 'tag-caida'],
      saleTagIds: [],
      potentialTagIds: [],
      flaggedTagIds: ['tag-potencial', 'tag-caida'],
    });

    await clearLifecycleTagsOnSale(db, accountId, contactId);

    expect(h.removeContactTag).toHaveBeenCalledTimes(2);
    expect(h.removeContactTag).toHaveBeenCalledWith(db, {
      accountId,
      contactId,
      tagId: 'tag-potencial',
    });
    expect(h.removeContactTag).toHaveBeenCalledWith(db, {
      accountId,
      contactId,
      tagId: 'tag-caida',
    });
  });

  it('no-ops when the contact has none of the flagged tags', async () => {
    const db = fakeDb({
      contactTags: [],
      saleTagIds: [],
      potentialTagIds: [],
      flaggedTagIds: ['tag-caida'],
    });

    await clearDroppedTagOnReactivation(db, accountId, contactId);

    expect(h.removeContactTag).not.toHaveBeenCalled();
  });

  it('never throws when the db call fails', async () => {
    const db = {
      from() {
        throw new Error('boom');
      },
    } as unknown as SupabaseClient;

    await expect(
      clearDroppedTagOnReactivation(db, accountId, contactId),
    ).resolves.toBeUndefined();
  });
});
