// =============================================================================
// hooks/admin/types.ts — Re-exporta os tipos do domínio credit-products
// para uso nos hooks e componentes de admin.
//
// Mantém um único ponto de importação para que mudanças no schema
// do backend sejam propagadas apenas aqui.
// =============================================================================

export type {
  CreditProductDetailResponse,
  CreditProductListResponse,
  CreditProductResponse,
  CreditProductRuleResponse,
  CreditProductRulesListResponse,
  ProductCreate,
  ProductListParams,
  ProductUpdate,
  RuleCreate,
} from '../../lib/api/credit-products';
