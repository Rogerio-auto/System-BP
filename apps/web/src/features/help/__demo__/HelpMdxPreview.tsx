import * as React from 'react';

import { HelpMDXProvider } from '../mdx-provider';

import Sample from './sample.mdx';

/**
 * Preview de smoke test do pipeline MDX (F10-S01).
 * Rota dev-only: /_dev/help-mdx-preview. Removida em F10-S02.
 */
export function HelpMdxPreview(): React.JSX.Element {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <HelpMDXProvider>
        <Sample />
      </HelpMDXProvider>
    </div>
  );
}
