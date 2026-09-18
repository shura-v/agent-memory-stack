import type { Interaction } from './interaction.js';
import { fields, generateKey, validateEnv, validateField } from '../config/settings.js';
import { catalog, resolveDeployment, selectionFromEnv } from '../deployment/model.js';
import type { Service } from '../deployment/model.js';
import { remember } from './interaction.js';
import { discoverModels, ModelAccessError } from './model-discovery.js';
import type { ModelDiscovery } from './model-discovery.js';
import { accountProviders } from '../config/providers.js';
import { displayHomePath, expandHomePath } from './paths.js';

export async function selectServices(ui: Interaction, existing: Record<string, string>): Promise<Service[]> {
  const plan = resolveDeployment(existing, { requireConnections: false });
  ui.note(catalog.filter(service => plan.services.includes(service.value))
    .map(service => `${service.label} (${service.description})`).join('\n'), 'Configured services');
  return plan.services;
}

// Advanced topology and networking are configured in .env, never through the wizard.
const setupFields = new Set([
  'DATA_DIR', 'LLM_BASE_URL', 'LLM_API_KEY', 'MEMORY_LLM_MODEL', 'KNOWLEDGE_LLM_MODEL',
  'CORE_API_KEY', 'CLIPROXY_API_KEY', 'CLIPROXY_AUTH_PROVIDER', 'MEMORY_PROMPT_MODE', 'LOG_LEVEL',
]);

export async function serverQuestions(ui: Interaction, existing: Record<string, string>, services = selectionFromEnv(existing), { listModels = discoverModels }: { listModels?: ModelDiscovery } = {}): Promise<Record<string, string>> {
  resolveDeployment(existing, { requireConnections: false });
  const values: Record<string, string> = { ...existing, AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: services.join(',') };
  const plan = resolveDeployment(values, { requireConnections: false });
  ui.note('Panel, MemoryProxy, and MCP publish localhost ports automatically. Apply keeps saved ports when available and chooses free ports when needed. Other interfaces stay private unless explicitly enabled in .env. Configure external domains and advanced connections in .env.', 'Local connections');
  let models: string[] | undefined;
  for (const field of fields.filter(field => plan.fields.includes(field.name) && setupFields.has(field.name))) {
    const previous = existing[field.name];
    const initial = previous ?? field.default;
    if (field.name === 'DATA_DIR') {
      const value = await ui.text({ id: field.name, message: field.label,
        initial: initial === undefined ? undefined : displayHomePath(initial),
        validate: value => validateField(field, expandHomePath(value)) });
      values[field.name] = expandHomePath(value);
      continue;
    }
    if (field.role) {
      values[field.name] = previous || remember(ui, `key:${field.name}`, () => generateKey(field.role!));
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
        if (choice !== 'manual') {
          values[field.name] = choice === 'saved' ? initial! : models[Number(choice.slice('model:'.length))]!;
          continue;
        }
      }
    }
    if (field.name === 'MEMORY_PROMPT_MODE') {
      ui.note('Choose what Core should remember from conversations. This changes memory extraction and summaries, not the model used to answer your requests.', field.label);
      values[field.name] = await ui.select(field.name, field.label, [
        { value: 'code', label: 'code — Project decisions, technical constraints, and team practices' },
        { value: 'chat', label: 'chat — Personal preferences, events, and lasting instructions' },
      ], initial);
      continue;
    }
    if (field.name === 'CLIPROXY_AUTH_PROVIDER') {
      values[field.name] = await ui.select(field.name, field.label,
        Object.entries(accountProviders).map(([value, provider]) => ({ value, label: provider.label })), initial);
      continue;
    }
    values[field.name] = field.choices
      ? await ui.select(field.name, field.label, field.choices.map(value => ({ value, label: value })), initial)
      : await ui.text({ id: field.name, message: field.label, secret: field.secret,
        initial: field.secret ? undefined : initial, placeholder: field.secret ? undefined : field.placeholder,
        validate: value => validateField(field, value) });
  }
  return validateEnv(values);
}
