import * as React from 'react';

import { DocPage } from './DocPage';

/**
 * Home da Central de Ajuda — alias semântico do DocPage com slug vazio.
 * Mantém-se como ponto de entrada único para a rota /ajuda no router.
 */
export function HelpHomePage(): React.JSX.Element {
  return <DocPage />;
}
