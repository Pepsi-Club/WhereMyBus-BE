export interface BusApiMetricIdentity {
  provider: string;
  operation: string;
}

export interface BusApiMetricDimension extends BusApiMetricIdentity {
  providerLabel: string;
  operationLabel: string;
}

export const BUS_API_METRIC_DIMENSIONS: ReadonlyArray<BusApiMetricDimension> =
  Object.freeze([
    Object.freeze({
      provider: 'seoul-bus',
      providerLabel: '서울 버스',
      operation: 'bus-arrival',
      operationLabel: '버스 도착 정보',
    }),
  ]);

export const SEOUL_BUS_ARRIVAL_METRIC: Readonly<BusApiMetricIdentity> =
  Object.freeze({ provider: 'seoul-bus', operation: 'bus-arrival' });

export interface MetricDimensionFilter {
  providers: string[];
  operations: string[];
}

export function getMetricDimensionCatalog() {
  return {
    providers: BUS_API_METRIC_DIMENSIONS.reduce<
      Array<{
        key: string;
        label: string;
        operations: Array<{ key: string; label: string }>;
      }>
    >((providers, dimension) => {
      let provider = providers.find(({ key }) => key === dimension.provider);
      if (!provider) {
        provider = {
          key: dimension.provider,
          label: dimension.providerLabel,
          operations: [],
        };
        providers.push(provider);
      }
      provider.operations.push({
        key: dimension.operation,
        label: dimension.operationLabel,
      });
      return providers;
    }, []),
  };
}

export function resolveMetricDimensionFilter(
  selection: { providers?: string[]; operations?: string[] },
  dimensions: ReadonlyArray<BusApiMetricDimension> = BUS_API_METRIC_DIMENSIONS,
): MetricDimensionFilter | null {
  const compatibleDimensions = dimensions.filter(
    ({ provider, operation }) =>
      (selection.providers === undefined ||
        selection.providers.includes(provider)) &&
      (selection.operations === undefined ||
        selection.operations.includes(operation)),
  );
  if (!compatibleDimensions.length) {
    return null;
  }
  return {
    providers: [
      ...new Set(compatibleDimensions.map(({ provider }) => provider)),
    ],
    operations: [
      ...new Set(compatibleDimensions.map(({ operation }) => operation)),
    ],
  };
}
