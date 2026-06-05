import type { TemplateResponse } from './schemas';

export interface TemplateOption {
  value: string;
  label: string;
}

export function buildTemplateOptions(
  templates: ReadonlyArray<Pick<TemplateResponse, 'id' | 'name'>>,
): TemplateOption[] {
  return [...templates]
    .map((t) => ({ value: t.id, label: t.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}
