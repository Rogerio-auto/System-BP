// =============================================================================
// components/comboboxes/index.ts — Barrel de comboboxes compartilhados.
//
// LeadCombobox   — busca live por leads (nome/email/CPF)
// CityCombobox   — busca live por cidades (nome)
// SimulationSelect — seleção de simulações de um lead (lista cronológica)
// =============================================================================

export { LeadCombobox } from './LeadCombobox';
export type { LeadComboboxProps } from './LeadCombobox';

export { CityCombobox } from './CityCombobox';
export type { CityComboboxProps } from './CityCombobox';

export { SimulationSelect } from './SimulationSelect';
export type { SimulationSelectProps } from './SimulationSelect';
