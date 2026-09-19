import { isDeepStrictEqual } from 'node:util';
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Document } from 'yaml';
import { envDocument, envLiteral } from '../runtime/native-env.js';

export type NativeFormat = 'yaml' | 'env' | 'json';
export type NativeValue = null | boolean | number | string | NativeValue[] | { [key: string]: NativeValue };
export interface NativeEdit { path: (string | number)[]; value?: NativeValue; delete?: boolean }
export interface NativeTemplateChange { path: string; reason: string }
const missing = Symbol('missing');
type Value = NativeValue | typeof missing;
const record = (value: Value): value is Record<string, NativeValue> => value !== missing && value !== null && typeof value === 'object' && !Array.isArray(value);
const location = (path: (string | number)[]): string => path.length ? '/' + path.map(String).map(s => s.replaceAll('~', '~0').replaceAll('/', '~1')).join('/') : '/';

function yamlDocument(text: string): Document {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error('Invalid native YAML document');
  return document;
}

export function parseNativeDocument(text: string, format: NativeFormat): NativeValue {
  if (format === 'yaml') {
    try {
      const value = yamlDocument(text).toJS({ maxAliasCount: 100 }) as NativeValue;
      // Configuration composition needs an acyclic value tree. Aliases may share
      // values, but recursive aliases cannot describe an independent override.
      JSON.stringify(value);
      return value;
    } catch { throw new Error('Invalid native YAML document'); }
  }
  if (format === 'env') return Object.fromEntries(envDocument(text).entries.map(entry => [entry.key, entry.value]));
  try { return JSON.parse(text) as NativeValue; }
  catch { throw new Error('Invalid native JSON document'); }
}

function changeValue(root: NativeValue, edit: NativeEdit): NativeValue {
  if (!edit.path.length) {
    if (edit.delete || edit.value === undefined) throw new Error('Cannot remove native document root');
    return structuredClone(edit.value);
  }
  let parent = root;
  for (const [index, key] of edit.path.slice(0, -1).entries()) {
    if (parent === null || typeof parent !== 'object') throw new Error(`Cannot edit native setting: ${location(edit.path)}`);
    if (!Object.hasOwn(parent, key)) Object.defineProperty(parent, key, { value: typeof edit.path[index + 1] === 'number' ? [] : {}, writable: true, enumerable: true, configurable: true });
    parent = (parent as Record<string | number, NativeValue>)[key];
  }
  if (parent === null || typeof parent !== 'object') throw new Error(`Cannot edit native setting: ${location(edit.path)}`);
  const key = edit.path.at(-1)!;
  if (edit.delete) {
    if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1);
    else delete (parent as Record<string | number, NativeValue>)[key];
  } else {
    if (edit.value === undefined) throw new Error(`Missing value for native setting: ${location(edit.path)}`);
    Object.defineProperty(parent, key, { value: structuredClone(edit.value), writable: true, enumerable: true, configurable: true });
  }
  return root;
}

export function updateNativeDocument(text: string, format: NativeFormat, edits: NativeEdit[]): string {
  if (!edits.length) { parseNativeDocument(text, format); return text; }
  if (format === 'yaml') {
    const document = yamlDocument(text);
    for (const edit of edits) {
      if (edit.delete) document.deleteIn(edit.path);
      else if (!edit.path.length) document.contents = document.createNode(edit.value);
      else document.setIn(edit.path, edit.value);
    }
    return document.toString({ lineWidth: 0 });
  }
  if (format === 'env') {
    const document = envDocument(text);
    for (const edit of edits) {
      if (edit.path.length !== 1 || typeof edit.path[0] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(edit.path[0])) throw new Error('Native env settings require a single variable name');
      const key = edit.path[0];
      const index = document.entries.findIndex(entry => entry.key === key);
      if (edit.delete) { if (index >= 0) document.entries.splice(index, 1); continue; }
      if (typeof edit.value !== 'string') throw new Error(`Native env setting must be a string: ${key}`);
      if (index >= 0 && document.entries[index].value === edit.value) continue;
      const previous = document.entries[index];
      const literal = envLiteral(edit.value);
      const inline = previous?.inline ?? '';
      const entry = { key, value: edit.value, before: previous?.before ?? '', inline, assignment: `${key}=${literal}${inline}\n` };
      if (index >= 0) document.entries[index] = entry; else document.entries.push(entry);
    }
    return document.entries.map(entry => entry.before + entry.assignment.replace(/\n?$/, '\n')).join('') + document.tail;
  }
  let value = parseNativeDocument(text, format);
  for (const edit of edits) value = changeValue(value, edit);
  return JSON.stringify(value, null, 2) + '\n';
}

function copyValue(value: NativeValue): NativeValue {
  if (Array.isArray(value)) return value.map(copyValue);
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyValue(child)]));
  return value;
}

function overlayValue(defaultValue: Value, override: NativeValue): NativeValue {
  if (!record(override)) return copyValue(override);
  const result = record(defaultValue) ? copyValue(defaultValue) as Record<string, NativeValue> : {};
  for (const [key, value] of Object.entries(override)) Object.defineProperty(result, key, {
    value: overlayValue(Object.hasOwn(result, key) ? result[key] : missing, value),
    writable: true, enumerable: true, configurable: true,
  });
  return result;
}

function pointerPath(pointer: string): string[] {
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw new Error(`Invalid native deletion JSON Pointer: ${JSON.stringify(pointer)}`);
  return pointer.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** Validate metadata separately so even declarations for inactive files are checked. */
export function validateNativeDeletions(value: unknown, allowedFilenames: readonly string[]): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native deletions must map filenames to JSON Pointer arrays');
  const entries: [string, string[]][] = [];
  for (const [filename, pointers] of Object.entries(value)) {
    if (!allowedFilenames.includes(filename)) throw new Error(`Unknown native filename in deletions.json: ${JSON.stringify(filename)}`);
    if (!Array.isArray(pointers) || pointers.some(pointer => typeof pointer !== 'string')) throw new Error(`Invalid native deletions for ${filename}: expected JSON Pointer array`);
    for (const pointer of pointers) {
      try { pointerPath(pointer); }
      catch { throw new Error(`Invalid native deletion JSON Pointer in ${filename}: ${JSON.stringify(pointer)}`); }
    }
    entries.push([filename, [...new Set(pointers as string[])]]);
  }
  return Object.fromEntries(entries);
}

function assignedPaths(value: NativeValue, path: string[] = []): string[][] {
  return record(value) ? Object.entries(value).flatMap(([key, child]) => assignedPaths(child, [...path, key])) : [path];
}

function isAncestor(parent: string[], child: string[]): boolean {
  return parent.length <= child.length && parent.every((part, index) => part === child[index]);
}

function checkDeletionPath(value: NativeValue, path: string[]): void {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current)) throw new Error(`Native deletion cannot address array elements: ${location(path)}`);
    if (!record(current) || !Object.hasOwn(current, key)) return;
    current = current[key];
  }
}

function deleteField(value: NativeValue, path: string[]): void {
  let parent = value;
  for (const key of path.slice(0, -1)) {
    if (!record(parent) || !Object.hasOwn(parent, key)) return;
    parent = parent[key];
  }
  if (record(parent)) delete parent[path.at(-1)!];
}

function difference(from: Value, to: Value, path: (string | number)[] = []): NativeEdit[] {
  if (record(from) && record(to)) return [...new Set([...Object.keys(from), ...Object.keys(to)])].flatMap(key => difference(Object.hasOwn(from, key) ? from[key] : missing, Object.hasOwn(to, key) ? to[key] : missing, [...path, key]));
  if (isDeepStrictEqual(from, to)) return [];
  return [{ path, ...(to === missing ? { delete: true } : { value: to }) }];
}

type Annotation = { comment?: string | null; commentBefore?: string | null; spaceBefore?: boolean };
function visitYaml(node: unknown, visit: (node: Annotation, path: string) => void, path = '$'): void {
  if (!node || typeof node !== 'object') return;
  visit(node as Annotation, path);
  if (isMap(node)) for (const pair of node.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    visitYaml(pair.key, visit, path + '/' + JSON.stringify(key) + ':key');
    visitYaml(pair.value, visit, path + '/' + JSON.stringify(key));
  }
  if (isSeq(node)) node.items.forEach((value, index) => visitYaml(value, visit, path + '/' + index));
}

function overrideValue(text: string | undefined, format: NativeFormat): NativeValue | undefined {
  if (text === undefined) return undefined;
  if (format === 'yaml') {
    const contents = yamlDocument(text).contents;
    if (contents === null || (isScalar(contents) && contents.value === null && contents.source === '')) return undefined;
  }
  return parseNativeDocument(text, format);
}

/** Compose copies only: neither of the visible source documents is rewritten. */
export function composeNativeDocument(defaultText: string, overrideText: string | undefined, format: NativeFormat, deletions: string[] = []): string {
  const defaults = parseNativeDocument(defaultText, format);
  const override = overrideValue(overrideText, format);
  const value = override === undefined ? copyValue(defaults) : overlayValue(defaults, override);
  const assignments = override === undefined ? [] : assignedPaths(override);
  for (const pointer of deletions) {
    const path = pointerPath(pointer);
    if (format === 'env' && (path.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(path[0]))) throw new Error(`Native env deletion requires a variable name: ${location(path)}`);
    if (assignments.some(assignment => isAncestor(path, assignment) || isAncestor(assignment, path))) throw new Error(`Native override assigns and deletes overlapping paths: ${location(path)}`);
    checkDeletionPath(defaults, path);
    checkDeletionPath(value, path);
    deleteField(value, path);
  }
  if (overrideText === undefined && !deletions.length) return defaultText;
  if (format === 'env') {
    const result = envDocument(defaultText);
    const overlay = envDocument(overrideText ?? '');
    for (const entry of overlay.entries) {
      const index = result.entries.findIndex(existing => existing.key === entry.key);
      if (index < 0) result.entries.push(entry);
      else result.entries[index] = { ...entry, before: entry.before || result.entries[index].before };
    }
    result.entries = result.entries.filter(entry => record(value) && Object.hasOwn(value, entry.key));
    return result.entries.map(entry => entry.before + entry.assignment.replace(/\n?$/, '\n')).join('') + (overlay.tail || result.tail);
  }
  let source = defaultText;
  if (format === 'yaml') {
    const document = yamlDocument(defaultText);
    // Materialize aliases before editing so a change at one path cannot modify
    // another path through a shared anchor, or leave a dangling deleted anchor.
    const expand = (node: unknown, current: NativeValue): unknown => {
      if (isAlias(node)) return document.createNode(current);
      if (isMap(node) && record(current)) for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : '';
        pair.value = expand(pair.value, current[key]);
      }
      if (isSeq(node) && Array.isArray(current)) node.items = node.items.map((child, index) => expand(child, current[index]));
      return node;
    };
    expand(document.contents, defaults);
    source = document.toString({ lineWidth: 0 });
  }
  let text = updateNativeDocument(source, format, difference(defaults, value));
  if (format === 'yaml' && overrideText !== undefined) {
    const overlay = yamlDocument(overrideText), result = yamlDocument(text);
    const annotations = new Map<string, Annotation>();
    const collect = (node: Annotation, path: string) => annotations.set(path, node);
    visitYaml(overlay, collect, '$document'); visitYaml(overlay.contents, collect);
    const apply = (node: Annotation, path: string) => {
      const annotation = annotations.get(path);
      if (annotation?.comment) node.comment = annotation.comment;
      if (annotation?.commentBefore) node.commentBefore = annotation.commentBefore;
      if (annotation?.spaceBefore) node.spaceBefore = true;
    };
    visitYaml(result, apply, '$document'); visitYaml(result.contents, apply);
    text = result.toString({ lineWidth: 0 });
  }
  return text;
}

/** Template examples are not schemas; diagnostics report paths and never values. */
export function nativeTemplateChanges(oldDefault: string, newDefault: string, overrideText: string | undefined, format: NativeFormat): NativeTemplateChange[] {
  if (overrideText === undefined) return [];
  const before = parseNativeDocument(oldDefault, format), after = parseNativeDocument(newDefault, format);
  const override = overrideValue(overrideText, format);
  if (override === undefined) return [];
  const changes: NativeTemplateChange[] = [];
  const type = (value: NativeValue) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const walk = (old: Value, next: Value, explicit: NativeValue, path: string[]) => {
    if (old !== missing && next === missing) { changes.push({ path: location(path), reason: 'Overridden path was removed from the upstream template' }); return; }
    if (old !== missing && next !== missing && type(old) !== type(next)) { changes.push({ path: location(path), reason: 'Overridden path changed type in the upstream template' }); return; }
    if (record(explicit)) for (const [key, child] of Object.entries(explicit)) walk(record(old) && Object.hasOwn(old, key) ? old[key] : missing, record(next) && Object.hasOwn(next, key) ? next[key] : missing, child, [...path, key]);
  };
  walk(before, after, override, []);
  return changes;
}
