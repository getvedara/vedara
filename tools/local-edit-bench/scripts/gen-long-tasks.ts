/**
 * Generates the long-file tasks (300–2000 lines of near-duplicate code) in tasks/.
 * The output is committed; rerun only when changing these tasks:  npm run gen-corpus
 *
 * Each task's after/ is derived from before/ by one targeted replacement, which must match exactly once.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_TASKS_DIR } from '../src/tasks.ts';
import type { TaskMeta } from '../src/types.ts';

const ENTITIES = [
  'account', 'address', 'invoice', 'payment', 'shipment', 'warehouse', 'product', 'supplier', 'customer', 'order',
  'refund', 'coupon', 'review', 'category', 'carrier', 'pallet', 'route', 'driver', 'vehicle', 'station',
  'ticket', 'agent', 'queue', 'region', 'store', 'shelf', 'batch', 'lot', 'contract', 'quote',
  'budget', 'ledger', 'receipt', 'voucher', 'tariff', 'parcel', 'manifest', 'depot', 'zone', 'bin',
];

const pascal = (s: string) => s[0].toUpperCase() + s.slice(1);
const upper = (s: string) => s.toUpperCase();

function replaceOnce(src: string, find: string, repl: string, id: string): string {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${id}: expected exactly one match for ${JSON.stringify(find)}, found ${n}`);
  return src.replace(find, repl);
}

interface Gen {
  meta: TaskMeta;
  before: Record<string, string>;
  after: Record<string, string>;
  check: Record<string, string>;
}

function write(gen: Gen): void {
  const dir = join(DEFAULT_TASKS_DIR, gen.meta.id);
  const put = (rel: string, content: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  put('task.json', JSON.stringify(gen.meta, null, 2) + '\n');
  for (const [f, c] of Object.entries(gen.before)) put(`before/${f}`, c);
  for (const [f, c] of Object.entries(gen.after)) put(`after/${f}`, c);
  for (const [f, c] of Object.entries(gen.check)) put(`check/${f}`, c);
  const lines = Object.values(gen.before).reduce((n, c) => n + c.split('\n').length, 0);
  console.log(`${gen.meta.id}: ${lines} lines`);
}

// ---------------------------------------------------------------------------------------------
// TypeScript: REST-style handlers, one copy-paste bug.

function tsRouteHandlers(): Gen {
  const ents = ENTITIES.slice(0, 16);
  const parts: string[] = [
    `export interface Request {\n  params: Record<string, string>;\n  body: Record<string, unknown>;\n}\n`,
    `export interface Response {\n  status: number;\n  body: unknown;\n}\n`,
    `export type Store = Map<string, Map<number, Record<string, unknown>>>;\n`,
    `function table(store: Store, name: string): Map<number, Record<string, unknown>> {\n  let t = store.get(name);\n  if (!t) {\n    t = new Map();\n    store.set(name, t);\n  }\n  return t;\n}\n`,
  ];
  for (const e of ents) {
    const P = pascal(e);
    parts.push(`// ----- ${e} -----

export function handleList${P}(req: Request, store: Store): Response {
  const rows = [...table(store, '${e}').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGet${P}(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, '${e}').get(id);
  if (!existing) {
    return { status: 404, body: { error: '${e} not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreate${P}(req: Request, store: Store): Response {
  const rows = table(store, '${e}');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdate${P}(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, '${e}');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: '${e} not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDelete${P}(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, '${e}');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: '${e} not found' } };
  }
  return { status: 204, body: null };
}
`);
  }
  const after = parts.join('\n');
  // Introduce the bug into the "before" version.
  const good = `  const existing = rows.get(id);\n  if (!existing) {\n    return { status: 404, body: { error: 'invoice not found' } };`;
  const before = replaceOnce(after, good, good.replace('status: 404', 'status: 400'), 'ts-long-route-handlers');
  return {
    meta: {
      id: 'ts-long-route-handlers',
      language: 'typescript',
      difficulty: 'hard',
      kind: 'bugfix',
      instruction:
        '`handleUpdateInvoice` returns status 400 when the invoice does not exist; it should return 404 like every other handler. Fix only that handler.',
      files: ['handlers.ts'],
      check: { type: 'node-test', entry: 'check.ts' },
    },
    before: { 'handlers.ts': before },
    after: { 'handlers.ts': after },
    check: {
      'check.ts': `import assert from 'node:assert/strict';
import * as h from './handlers.ts';

const store: h.Store = new Map();
const req = (params: Record<string, string>, body: Record<string, unknown> = {}): h.Request => ({ params, body });
assert.equal(h.handleUpdateInvoice(req({ id: '9' }), store).status, 404);
assert.equal(h.handleCreateInvoice(req({}, { total: 5 }), store).status, 201);
assert.deepEqual(h.handleUpdateInvoice(req({ id: '1' }, { total: 7 }), store), { status: 200, body: { total: 7, id: 1 } });
assert.equal(h.handleUpdatePayment(req({ id: '9' }), store).status, 404);
assert.equal(h.handleUpdateAddress(req({ id: '9' }), store).status, 404);
assert.equal(h.handleGetInvoice(req({ id: '2' }), store).status, 404);
assert.equal(h.handleDeleteInvoice(req({ id: '1' }), store).status, 204);
console.log('ok');
`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// TypeScript: near-identical validators, add a parameter to one.

function tsValidators(): Gen {
  const ents = ENTITIES;
  const fieldsFor = (i: number) => ['name', 'code', 'description', 'owner', 'status'].slice(0, 3 + (i % 3));
  const parts: string[] = [`export type Input = Record<string, unknown>;\n`];
  ents.forEach((e, i) => {
    const P = pascal(e);
    const fields = fieldsFor(i);
    const checks = fields
      .map(
        (f) => `  const ${f} = input.${f};
  if (typeof ${f} !== 'string' || ${f}.trim() === '') {
    errors.push('${e}.${f} is required');
  } else if (${f}.length > 64) {
    errors.push('${e}.${f} is too long');
  }`,
      )
      .join('\n');
    parts.push(`/** Validates a ${e} payload; returns a list of error messages. */
export function validate${P}(input: Input): string[] {
  const errors: string[] = [];
${checks}
  return errors;
}
`);
  });
  const before = parts.join('\n');
  const sig = `export function validateShipment(input: Input): string[] {`;
  let after = replaceOnce(before, sig, `export function validateShipment(input: Input, maxLength: number = 64): string[] {`, 'ts-long-validators');
  // Only the shipment block's literals change.
  const start = after.indexOf('export function validateShipment');
  const end = after.indexOf('return errors;', start);
  after = after.slice(0, start) + after.slice(start, end).replace(/\.length > 64\)/g, '.length > maxLength)') + after.slice(end);
  return {
    meta: {
      id: 'ts-long-validators',
      language: 'typescript',
      difficulty: 'hard',
      kind: 'add-param',
      instruction:
        'Add an optional second parameter `maxLength: number = 64` to `validateShipment` and use it instead of the hard-coded 64 in every length check of that function. Do not change any other validator.',
      files: ['validators.ts'],
      check: { type: 'node-test', entry: 'check.ts' },
    },
    before: { 'validators.ts': before },
    after: { 'validators.ts': after },
    check: {
      'check.ts': `import assert from 'node:assert/strict';
import * as v from './validators.ts';

const vs = v.validateShipment as (input: v.Input, maxLength?: number) => string[];
const ok = { name: 'abcdef', code: 'abcdef', description: 'abcdef', owner: 'abcdef', status: 'abcdef' };
assert.deepEqual(vs(ok), []);
assert.ok(vs(ok, 5).includes('shipment.name is too long'));
assert.ok(vs(ok, 5).includes('shipment.code is too long'));
assert.deepEqual(vs({ ...ok, name: 'x'.repeat(65) }, 100), []);
assert.deepEqual(vs({ ...ok, name: 'x'.repeat(65) }), ['shipment.name is too long']);
assert.deepEqual((v.validatePayment as (i: v.Input, n?: number) => string[])({ ...ok, name: 'x'.repeat(10) }, 5), []);
assert.deepEqual(v.validateWarehouse({ ...ok, code: 'x'.repeat(65) }), ['warehouse.code is too long']);
console.log('ok');
`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// TypeScript: a ~2000-line reducer, rename one action type among look-alikes.

function tsReducer(): Gen {
  const ents = ENTITIES;
  const verbs = ['Added', 'Removed', 'Updated', 'Cleared'];
  const consts: string[] = [];
  const creators: string[] = [];
  const cases: string[] = [];
  for (const e of ents) {
    for (const v of verbs) {
      const C = `${upper(e)}_ITEM_${upper(v)}`;
      consts.push(`export const ${C} = '${e}/item${v}';`);
      creators.push(`export function ${e}Item${v}(id: number, qty = 1): Action {
  return { type: ${C}, payload: { collection: '${e}', id, qty } };
}
`);
      const body =
        v === 'Added'
          ? `      const items = { ...(state.${e} ?? {}) };
      items[action.payload.id] = (items[action.payload.id] ?? 0) + action.payload.qty;
      return { ...state, ${e}: items };`
          : v === 'Cleared'
            ? `      return { ...state, ${e}: {} };`
            : v === 'Removed'
            ? `      const items = { ...(state.${e} ?? {}) };
      delete items[action.payload.id];
      return { ...state, ${e}: items };`
            : `      const items = { ...(state.${e} ?? {}) };
      if (!(action.payload.id in items)) return state;
      items[action.payload.id] = action.payload.qty;
      return { ...state, ${e}: items };`;
      cases.push(`    case ${C}: {
${body}
    }`);
    }
  }
  const before = `${consts.join('\n')}

export interface Action {
  type: string;
  payload: { collection: string; id: number; qty: number };
}

export type State = Record<string, Record<number, number> | undefined>;

${creators.join('\n')}
export function reducer(state: State = {}, action: Action): State {
  switch (action.type) {
${cases.join('\n')}
    default:
      return state;
  }
}
`;
  let after = before.replace(/ORDER_ITEM_REMOVED/g, 'ORDER_LINE_REMOVED');
  after = replaceOnce(after, `'order/itemRemoved'`, `'order/lineRemoved'`, 'ts-long-reducer-rename');
  return {
    meta: {
      id: 'ts-long-reducer-rename',
      language: 'typescript',
      difficulty: 'hard',
      kind: 'rename',
      instruction:
        "Rename the action type constant `ORDER_ITEM_REMOVED` to `ORDER_LINE_REMOVED` and change its string value from 'order/itemRemoved' to 'order/lineRemoved'. Update every use of the constant. Do not rename the `orderItemRemoved` action creator or touch any other action type.",
      files: ['reducer.ts'],
      check: { type: 'node-test', entry: 'check.ts' },
    },
    before: { 'reducer.ts': before },
    after: { 'reducer.ts': after },
    check: {
      'check.ts': `import assert from 'node:assert/strict';
import * as r from './reducer.ts';

const m = r as Record<string, unknown>;
assert.equal(m.ORDER_LINE_REMOVED, 'order/lineRemoved');
assert.equal(m.ORDER_ITEM_REMOVED, undefined);
assert.equal(r.ORDER_ITEM_ADDED, 'order/itemAdded');
assert.equal(r.CUSTOMER_ITEM_REMOVED, 'customer/itemRemoved');
let s = r.reducer({}, r.orderItemAdded(7, 2));
assert.deepEqual(s.order, { 7: 2 });
assert.equal(r.orderItemRemoved(7).type, 'order/lineRemoved');
s = r.reducer(s, r.orderItemRemoved(7));
assert.deepEqual(s.order, {});
s = r.reducer(s, r.customerItemAdded(1));
s = r.reducer(s, r.customerItemRemoved(1));
assert.deepEqual(s.customer, {});
console.log('ok');
`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Python: CRUD functions over a dict store, copy-paste bug in one delete.

function pyHandlers(): Gen {
  const ents = ENTITIES.slice(0, 18);
  const parts = [
    `"""In-memory CRUD helpers, one block per collection."""\n\nfrom typing import Any, Dict, List, Optional\n\nStore = Dict[str, Dict[int, Dict[str, Any]]]\n\n\ndef _table(store: Store, name: str) -> Dict[int, Dict[str, Any]]:\n    return store.setdefault(name, {})\n`,
  ];
  for (const e of ents) {
    const plural = `${e}s`;
    parts.push(`
# ----- ${plural} -----


def list_${plural}(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "${plural}").values())
    return rows[:limit]


def get_${e}(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "${plural}").get(record_id)


def create_${e}(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "${plural}")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_${e}(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "${plural}")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_${e}(store: Store, record_id: int) -> bool:
    rows = _table(store, "${plural}")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True
`);
  }
  const after = parts.join('');
  const good = `def delete_payment(store: Store, record_id: int) -> bool:\n    rows = _table(store, "payments")`;
  const before = replaceOnce(after, good, good.replace('"payments"', '"invoices"'), 'py-long-crud');
  return {
    meta: {
      id: 'py-long-crud',
      language: 'python',
      difficulty: 'hard',
      kind: 'bugfix',
      instruction: '`delete_payment` looks up and deletes records in the wrong collection. Fix it so it operates on payments, like the other payment functions.',
      files: ['crud.py'],
      check: { type: 'python-test', entry: 'check.py' },
    },
    before: { 'crud.py': before },
    after: { 'crud.py': after },
    check: {
      'check.py': `import crud

store = {}
inv = crud.create_invoice(store, {"total": 10})
pay = crud.create_payment(store, {"amount": 10})
assert crud.delete_payment(store, pay["id"]) is True
assert crud.get_payment(store, pay["id"]) is None
assert crud.get_invoice(store, inv["id"]) == {"total": 10, "id": 1}
assert crud.delete_payment(store, 99) is False
assert crud.delete_invoice(store, inv["id"]) is True
assert crud.list_invoices(store) == []
print("ok")
`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Python: serializers in a class hierarchy (indentation), add a keyword parameter to one.

function pySerializers(): Gen {
  const ents = ENTITIES;
  const fieldsFor = (i: number) => ['name', 'code', 'created_at', 'updated_at', 'owner', 'notes'].slice(0, 3 + (i % 4));
  const parts = [`"""Serializers: one class per entity, each turning a record dict into an API payload."""\n\nfrom typing import Any, Dict\n\n\nclass BaseSerializer:\n    entity = "base"\n\n    def envelope(self, payload: Dict[str, Any]) -> Dict[str, Any]:\n        return {"type": self.entity, "data": payload}\n`];
  ents.forEach((e, i) => {
    const P = pascal(e);
    const fields = fieldsFor(i)
      .map((f) => `        if record.get("${f}") is not None:\n            payload["${f}"] = record["${f}"]`)
      .join('\n');
    parts.push(`

class ${P}Serializer(BaseSerializer):
    entity = "${e}"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
${fields}
        return self.envelope(payload)
`);
  });
  const before = parts.join('');
  const start = before.indexOf('class WarehouseSerializer');
  const end = before.indexOf('return self.envelope(payload)', start);
  let block = before.slice(start, end);
  block = replaceOnce(
    block,
    `    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:\n        payload: Dict[str, Any] = {}\n        payload["id"] = record["id"]`,
    `    def serialize(self, record: Dict[str, Any], include_id: bool = True) -> Dict[str, Any]:\n        payload: Dict[str, Any] = {}\n        if include_id:\n            payload["id"] = record["id"]`,
    'py-long-serializers',
  );
  const after = before.slice(0, start) + block + before.slice(end);
  return {
    meta: {
      id: 'py-long-serializers',
      language: 'python',
      difficulty: 'hard',
      kind: 'add-param',
      instruction:
        'Add a keyword parameter `include_id: bool = True` to `WarehouseSerializer.serialize`. When it is False, the payload must not contain "id". Do not change any other serializer.',
      files: ['serializers.py'],
      check: { type: 'python-test', entry: 'check.py' },
    },
    before: { 'serializers.py': before },
    after: { 'serializers.py': after },
    check: {
      'check.py': `import inspect
import serializers as s

rec = {"id": 4, "name": "North", "code": "N1"}
assert s.WarehouseSerializer().serialize(rec) == {"type": "warehouse", "data": {"id": 4, "name": "North", "code": "N1"}}
assert s.WarehouseSerializer().serialize(rec, include_id=False) == {"type": "warehouse", "data": {"name": "North", "code": "N1"}}
assert "include_id" not in inspect.signature(s.ProductSerializer.serialize).parameters
assert s.ProductSerializer().serialize(rec)["data"]["id"] == 4
print("ok")
`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rust: key=value record parsers, copy-paste bug in one.

function rsParsers(): Gen {
  const ents = ENTITIES;
  const parts = [`#[derive(Debug, PartialEq)]
pub enum ParseError {
    MissingField(&'static str),
    BadNumber(String),
}

fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    line.split(';').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        if k.trim() == key { Some(v.trim()) } else { None }
    })
}

fn number(line: &str, key: &'static str) -> Result<u32, ParseError> {
    let raw = field(line, key).ok_or(ParseError::MissingField(key))?;
    raw.parse::<u32>().map_err(|_| ParseError::BadNumber(raw.to_string()))
}
`];
  for (const e of ents) {
    const P = pascal(e);
    parts.push(`
#[derive(Debug, PartialEq)]
pub struct ${P} {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_${e}(line: &str) -> Result<${P}, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(${P} { id, width, height, weight })
}
`);
  }
  const after = parts.join('');
  const good = `    let weight = number(line, "weight")?;\n    Ok(Pallet { id, width, height, weight })`;
  const before = replaceOnce(after, good, `    let weight = number(line, "weight")?;\n    Ok(Pallet { id, width, height: weight, weight: height })`, 'rs-long-parsers');
  return {
    meta: {
      id: 'rs-long-parsers',
      language: 'rust',
      difficulty: 'hard',
      kind: 'bugfix',
      instruction: '`parse_pallet` swaps the height and weight fields when building the `Pallet`. Fix it so each field gets its own value, like the other parsers.',
      files: ['parsers.rs'],
      check: { type: 'rust-test', entry: 'check.rs' },
    },
    before: { 'parsers.rs': before },
    after: { 'parsers.rs': after },
    check: {
      'check.rs': `#[path = "parsers.rs"]
mod parsers;
use parsers::*;

#[test]
fn pallet_fields() {
    let p = parse_pallet("id=1; width=2; height=3; weight=4").unwrap();
    assert_eq!(p, Pallet { id: 1, width: 2, height: 3, weight: 4 });
}

#[test]
fn others_unchanged() {
    let r = parse_route("id=9;width=8;height=7;weight=6").unwrap();
    assert_eq!(r, Route { id: 9, width: 8, height: 7, weight: 6 });
    assert_eq!(parse_pallet("id=1"), Err(ParseError::MissingField("width")));
}
`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Go: list handlers, change one default precisely (normalized comparison).

function goHandlers(): Gen {
  const ents = ENTITIES;
  const parts = [`package api

import (
\t"net/http"
\t"strconv"
)

type Page struct {
\tOffset int
\tSize   int
}

func parsePage(r *http.Request, defaultSize int) Page {
\tsize, err := strconv.Atoi(r.URL.Query().Get("size"))
\tif err != nil || size <= 0 {
\t\tsize = defaultSize
\t}
\toffset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
\treturn Page{Offset: offset, Size: size}
}
`];
  for (const e of ents) {
    const P = pascal(e);
    parts.push(`
// HandleList${P}s lists ${e}s.
func HandleList${P}s(store Store) http.HandlerFunc {
\treturn func(w http.ResponseWriter, r *http.Request) {
\t\tpageSize := 20
\t\tpage := parsePage(r, pageSize)
\t\trows, err := store.List("${e}", page.Offset, page.Size)
\t\tif err != nil {
\t\t\thttp.Error(w, err.Error(), http.StatusInternalServerError)
\t\t\treturn
\t\t}
\t\twriteJSON(w, http.StatusOK, rows)
\t}
}

// HandleGet${P} returns one ${e}.
func HandleGet${P}(store Store) http.HandlerFunc {
\treturn func(w http.ResponseWriter, r *http.Request) {
\t\tid, err := strconv.Atoi(r.PathValue("id"))
\t\tif err != nil {
\t\t\thttp.Error(w, "bad id", http.StatusBadRequest)
\t\t\treturn
\t\t}
\t\trow, ok := store.Get("${e}", id)
\t\tif !ok {
\t\t\thttp.Error(w, "${e} not found", http.StatusNotFound)
\t\t\treturn
\t\t}
\t\twriteJSON(w, http.StatusOK, row)
\t}
}
`);
  }
  const before = parts.join('');
  const after = replaceOnce(
    before,
    `func HandleListWarehouses(store Store) http.HandlerFunc {\n\treturn func(w http.ResponseWriter, r *http.Request) {\n\t\tpageSize := 20`,
    `func HandleListWarehouses(store Store) http.HandlerFunc {\n\treturn func(w http.ResponseWriter, r *http.Request) {\n\t\tpageSize := 50`,
    'go-long-handlers',
  );
  return {
    meta: {
      id: 'go-long-handlers',
      language: 'go',
      difficulty: 'hard',
      kind: 'bugfix',
      instruction: 'In `HandleListWarehouses`, change the default page size (`pageSize := 20`) to 50. Leave every other handler unchanged.',
      files: ['handlers.go'],
      check: { type: 'normalized' },
    },
    before: { 'handlers.go': before },
    after: { 'handlers.go': after },
    check: {},
  };
}

for (const gen of [tsRouteHandlers(), tsValidators(), tsReducer(), pyHandlers(), pySerializers(), rsParsers(), goHandlers()]) write(gen);
