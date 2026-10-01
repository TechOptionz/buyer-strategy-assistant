/**
 * Vendor-neutral market data adapter (Section 8). Assessment logic depends only on this interface,
 * so a licensed provider can be added without rewriting it. No live provider is assumed: the exact
 * "REI" product and its usage rights must be confirmed before an adapter is connected.
 */

export type ProviderFailure =
  | { status: "unavailable"; message: string }
  | { status: "stale"; message: string }
  | { status: "access_denied"; message: string }
  | { status: "provider_failure"; message: string; retryable: boolean }
  | { status: "not_configured"; message: string };

export interface ProviderMetric {
  area: string;
  propertyType: string;
  metric: string;
  value: number;
  unit: string;
  periodStart?: string;
  periodEnd: string;
  providerRecordRef: string;
  methodology?: string;
  quality?: Record<string, unknown>;
}

export type ProviderResult<T> = { status: "ok"; data: T; retrievedAt: string; attribution?: string } | ProviderFailure;

export interface PropertyDataProvider {
  readonly id: string;
  readonly label: string;
  resolveArea(query: string): Promise<ProviderResult<{ areaId: string; name: string; state?: string; postcode?: string }[]>>;
  getAreaStatistics(areaId: string, propertyType: string, period: { from?: string; to: string }): Promise<ProviderResult<ProviderMetric[]>>;
  getRentalEstimate(address: string): Promise<ProviderResult<ProviderMetric>>;
  getComparableSales(address: string): Promise<ProviderResult<ProviderMetric[]>>;
}

/** Placeholder adapter used until a licensed provider and credentials are configured. */
export class NotConfiguredProvider implements PropertyDataProvider {
  readonly id = "none";
  readonly label = "No market data provider configured";
  private fail(): ProviderFailure {
    return {
      status: "not_configured",
      message: "No licensed market data provider is configured. Enter dated evidence manually with its source.",
    };
  }
  async resolveArea() {
    return this.fail();
  }
  async getAreaStatistics() {
    return this.fail();
  }
  async getRentalEstimate() {
    return this.fail();
  }
  async getComparableSales() {
    return this.fail();
  }
}

export function getProvider(): PropertyDataProvider {
  // Register real adapters here once MARKET_PROVIDER and its credentials are confirmed, e.g.
  // if (process.env.MARKET_PROVIDER === "<vendor>") return new VendorProvider(process.env.MARKET_PROVIDER_API_KEY!);
  return new NotConfiguredProvider();
}
