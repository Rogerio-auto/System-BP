import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utilitário canônico para composição de classes Tailwind.
 * clsx: lida com condicionais, arrays e objetos.
 * twMerge: resolve conflitos de classes Tailwind (ex: p-4 + p-2 → p-2).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
