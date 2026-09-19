import { internalModelFields, internalModelSource, usesLocalInternalModels } from '../config/internal-llm.js';
import type { Field } from '../config/settings.js';
import type { Interaction } from './interaction.js';
import { fields, generateKey, validateEnv, validateField } from '../config/settings.js';
import { catalog, resolveDeployment, selectionFromEnv } from '../deployment/model.js';
import type { Service } from '../deployment/model.js';
import { remember } from './interaction.js';
import { discoverModels, ModelAccessError } from './model-discovery.js';
import type { ModelDiscovery } from './model-discovery.js';
import { accountProviders } from '../config/providers.js';

export async function selectServices(ui: Interaction, existing: Record<string, string>): Promise<Service[]> {
  const plan = resolveDeployment(existing, { requireConnections: false });
  ui.note(catalog.filter(service => plan.services.includes(service.value))
    .map(service => `${service.label} (${service.description})`).join('\n'), 'Configured services');
  return plan.services;
}

// Advanced topology and networking are configured in .env, never through the wizard.
const setupFields = new Set([
  'LLM_BASE_URL', 'LLM_API_KEY', 'MEMORY_LLM_MODEL', 'KNOWLEDGE_LLM_MODEL',
  'CORE_API_KEY', 'CLIPROXY_API_KEY', 'MEMORY_PROMPT_MODE', 'LOG_LEVEL',
]);

export async function serverQuestions(ui: Interaction, existing: Record<string, string>, services = selectionFromEnv(existing), { listModels = discoverModels }: { listModels?: ModelDiscovery } = {}): Promise<Record<string, string>> {
  resolveDeployment(existing, { requireConnections: false });
  const values: Record<string, string> = { ...existing, AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: services.join(',') };
  // Keep generated credentials before source-dependent questions in navigation history.
  for (const field of fields.filter(field => field.role && services.includes(field.role === 'core' ? 'core' : 'cli-proxy-api'))) {
    values[field.name] = existing[field.name] || remember(ui, `key:${field.name}`, () => generateKey(field.role!));
  }
  if (services.includes('cli-proxy-api')) {
    const field = fields.find(field => field.name === 'CLIPROXY_AUTH_PROVIDER')!;
    values[field.name] = await ui.select(field.name, field.label,
      Object.entries(accountProviders).map(([value, provider]) => ({ value, label: provider.label })), existing[field.name] ?? field.default);
  }
  if (internalModelFields(values).length && services.includes('cli-proxy-api')) {
    values.INTERNAL_LLM_SOURCE = await ui.select('INTERNAL_LLM_SOURCE', 'Models for memory and Knowledge', [
      { value: 'cliproxy', label: "Use this stack's CLIProxyAPI" },
      { value: 'external', label: 'Connect another model API' },
    ], Object.keys(existing).length ? internalModelSource(existing) : 'cliproxy');
  }
  const plan = resolveDeployment(values, { requireConnections: false });
  const localModels = usesLocalInternalModels(values);
  if (localModels) ui.note('Core and Knowledge use this stack’s CLIProxyAPI with separate model choices. Missing models are selected during Apply, after account authorization. Your agent selects its own model independently.', 'Internal models');
  ui.note('Panel, MemoryProxy, and MCP publish localhost ports automatically. Apply keeps saved ports when available and chooses free ports when needed. Other interfaces stay private unless explicitly enabled in .env. Configure external domains and advanced connections in .env.', 'Local connections');
  let models: string[] | undefined;
  for (const field of fields.filter(field => plan.fields.includes(field.name) && setupFields.has(field.name))) {
    if (localModels && internalModelFields(values).includes(field.name as 'MEMORY_LLM_MODEL' | 'KNOWLEDGE_LLM_MODEL')) continue;
    const previous = existing[field.name];
    const initial = previous ?? field.default;
    if (field.role) {
      continue;
    }
    if (field.secret && previous && await ui.confirm(`keep:${field.name}`, `Keep existing ${field.label}?`, true)) {
      values[field.name] = previous;
      continue;
    }
    if (field.name === 'MEMORY_LLM_MODEL' || field.name === 'KNOWLEDGE_LLM_MODEL') {
      if (models === undefined) {
        let attempt = 0;
        while (models === undefined) {
          ui.note('Loading available models from your API (up to 5 seconds).', 'Models');
          try { models = await remember(ui, `provider-models:${attempt}`, () => listModels(values.LLM_BASE_URL, values.LLM_API_KEY), [values.LLM_BASE_URL, values.LLM_API_KEY]); }
          catch (error) {
            if (!(error instanceof ModelAccessError)) { models = []; break; }
            ui.note(`${error.message} Enter the key again, or use Esc to edit earlier answers.`, 'API access');
            const keyField = fields.find(item => item.name === 'LLM_API_KEY')!;
            values.LLM_API_KEY = await ui.text({ id: `LLM_API_KEY:retry:${attempt++}`, message: keyField.label,
              secret: true, validate: value => validateField(keyField, value) });
          }
        }
        models = models.filter(model => !validateField(field, model));
        if (!models.length) ui.note('No model list is available. Enter the model names manually.', 'Models');
      }
      values[field.name] = await selectModel(ui, field, models, initial);
      continue;
    }
    if (field.name === 'MEMORY_PROMPT_MODE') {
      ui.note('Choose what Core should remember from conversations. This changes memory extraction and summaries, not the model used to answer your requests.', field.label);
      values[field.name] = await ui.select(field.name, field.label, [
        { value: 'code', label: 'code — Project decisions, technical constraints, and team practices' },
        { value: 'chat', label: 'chat — Personal preferences, events, and lasting instructions' },
      ], initial);
      continue;
    }
    values[field.name] = field.choices
      ? await ui.select(field.name, field.label, field.choices.map(value => ({ value, label: value })), initial)
      : await ui.text({ id: field.name, message: field.label, secret: field.secret,
        initial: field.secret ? undefined : initial, placeholder: field.secret ? undefined : field.placeholder,
        validate: value => validateField(field, value) });
  }
  return validateEnv(values, { allowPendingModels: true });
}

/** Shared model choice for external setup and deferred local Apply. */
export async function selectModel(ui: Interaction, field: Field, models: string[], initial?: string): Promise<string> {
  models = models.filter(model => !validateField(field, model));
  if (models.length) {
    const choices = models.map((model, index) => ({ value: `model:${index}`, label: model }));
    const savedIndex = initial ? models.indexOf(initial) : -1;
    let selected = savedIndex >= 0 ? `model:${savedIndex}` : undefined;
    if (initial && savedIndex < 0 && !validateField(field, initial)) {
      choices.unshift({ value: 'saved', label: `${initial} (saved; not listed)` });
      selected = 'saved';
    }
    choices.push({ value: 'manual', label: 'Enter a model manually' });
    const choice = await ui.select(field.name, field.label, choices, selected);
    if (choice !== 'manual') return choice === 'saved' ? initial! : models[Number(choice.slice('model:'.length))]!;
  }
  return ui.text({ id: field.name, message: field.label, initial, validate: value => validateField(field, value) });
}
